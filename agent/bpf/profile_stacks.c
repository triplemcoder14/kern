// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define MAX_STACK_DEPTH 127

struct stack_event {
	__u64 ts_ns;
	__u32 pid;
	__s32 stack_id;
};

struct {
	__uint(type, BPF_MAP_TYPE_STACK_TRACE);
	__uint(max_entries, 2048);
	__uint(key_size, sizeof(__u32));
	__uint(value_size, MAX_STACK_DEPTH * sizeof(__u64));
} kern_profile_stacks SEC(".maps");

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 256 * 1024);
} kern_profile_stack_events SEC(".maps");

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

	__s32 stack_id = bpf_get_stackid(ctx, &kern_profile_stacks, 0);
	if (stack_id < 0) {
		return 0;
	}

	struct stack_event *ev = bpf_ringbuf_reserve(&kern_profile_stack_events, sizeof(*ev), 0);
	if (!ev) {
		return 0;
	}

	ev->ts_ns = bpf_ktime_get_ns();
	ev->pid = pid;
	ev->stack_id = stack_id;
	bpf_ringbuf_submit(ev, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
