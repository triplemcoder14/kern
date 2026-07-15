// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define MAX_INLINE_STACK 16
/* ~100 Hz per CPU: sample at most once per 10ms on each CPU. */
#define SAMPLE_INTERVAL_NS 10000000ULL

struct stack_event {
	__u64 ts_ns;
	__u32 pid;
	__u32 n_ips;
	__u64 ips[MAX_INLINE_STACK];
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 256 * 1024);
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

	long n = bpf_get_stack(ctx, &ev->ips[0], sizeof(ev->ips), 0);
	if (n <= 0) {
		bpf_ringbuf_discard(ev, 0);
		return 0;
	}
	ev->n_ips = (__u32)(n / sizeof(__u64));
	if (ev->n_ips > MAX_INLINE_STACK) {
		ev->n_ips = MAX_INLINE_STACK;
	}

	bpf_ringbuf_submit(ev, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
