// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

// #define MAX_INLINE_STACK 16
#define MAX_INLINE_STACK 12
/* ~100 Hz per CPU: sample at most once per 10ms on each CPU. */
// #define SAMPLE_INTERVAL_NS 10000000ULL
/* ~20 Hz per CPU: sample at most once per 50ms on each CPU (keeps RSS/CPU low). */
#define SAMPLE_INTERVAL_NS 50000000ULL

#ifndef BPF_F_USER_STACK
#define BPF_F_USER_STACK (1ULL << 8)
#endif

struct stack_event {
	__u64 ts_ns;
	__u32 pid;  /* thread id (prev on sched_switch) */
	__u32 tgid;
	__u32 n_kern;
	__u32 n_user;
	__u64 kern_ips[MAX_INLINE_STACK];
	__u64 user_ips[MAX_INLINE_STACK];
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	// __uint(max_entries, 256 * 1024);
	__uint(max_entries, 128 * 1024);
} kern_profile_stack_events SEC(".maps");

struct {
	__uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
	__uint(max_entries, 1);
	__type(key, __u32);
	__type(value, __u64);
} last_sample_ns SEC(".maps");

struct trace_event_raw_sched_switch {
	__u64 unused;
	char prev_comm[16];
	__s32 prev_pid;
	__s32 prev_prio;
	__s64 prev_state;
	char next_comm[16];
	__s32 next_pid;
	__s32 next_prio;
};

SEC("tracepoint/sched/sched_switch")
int tp_profile_sched_switch(struct trace_event_raw_sched_switch *ctx)
{
	__u32 pid = ctx->prev_pid;
	if (pid <= 0) {
		return 0;
	}

	__u32 key = 0;
	__u64 now = bpf_ktime_get_ns();
	__u64 *last = bpf_map_lookup_elem(&last_sample_ns, &key);
	if (last) {
		if (now - *last < SAMPLE_INTERVAL_NS) {
			return 0;
		}
		*last = now;
	}

	struct stack_event *ev = bpf_ringbuf_reserve(&kern_profile_stack_events, sizeof(*ev), 0);
	if (!ev) {
		return 0;
	}

	__builtin_memset(ev, 0, sizeof(*ev));
	ev->ts_ns = now;
	ev->pid = pid;
	/* On sched_switch entry, current is typically still prev; use for tgid. */
	ev->tgid = bpf_get_current_pid_tgid() >> 32;

	long n_kern = bpf_get_stack(ctx, &ev->kern_ips[0], sizeof(ev->kern_ips), 0);
	if (n_kern > 0) {
		ev->n_kern = (__u32)(n_kern / sizeof(__u64));
		if (ev->n_kern > MAX_INLINE_STACK) {
			ev->n_kern = MAX_INLINE_STACK;
		}
	}

	/* Frame-pointer walk of userspace. Empty when FP missing / task in kernel-only. */
	long n_user = bpf_get_stack(ctx, &ev->user_ips[0], sizeof(ev->user_ips), BPF_F_USER_STACK);
	if (n_user > 0) {
		ev->n_user = (__u32)(n_user / sizeof(__u64));
		if (ev->n_user > MAX_INLINE_STACK) {
			ev->n_user = MAX_INLINE_STACK;
		}
	}

	if (ev->n_kern == 0 && ev->n_user == 0) {
		bpf_ringbuf_discard(ev, 0);
		return 0;
	}

	bpf_ringbuf_submit(ev, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
