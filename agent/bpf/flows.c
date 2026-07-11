// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define AF_INET 2
#define IPPROTO_TCP 6
#define TCP_ESTABLISHED 1

struct flow_event {
	__u64 ts_ns;
	__u32 saddr;
	__u32 daddr;
	__u16 sport;
	__u16 dport;
	__u8 protocol;
	__u8 pad;
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 256 * 1024);
} kern_flow_events SEC(".maps");

struct trace_event_raw_inet_sock_set_state {
	__u64 unused;
	void *skaddr;
	int oldstate;
	int newstate;
	__u16 sport;
	__u16 dport;
	__u16 family;
	__u16 protocol;
	__u8 saddr[4];
	__u8 daddr[4];
	__u8 saddr_v6[16];
	__u8 daddr_v6[16];
};

SEC("tracepoint/sock/inet_sock_set_state")
int tp_inet_sock_set_state(struct trace_event_raw_inet_sock_set_state *ctx)
{
	if (ctx->family != AF_INET || ctx->protocol != IPPROTO_TCP) {
		return 0;
	}

	if (ctx->newstate != TCP_ESTABLISHED) {
		return 0;
	}

	struct flow_event *ev = bpf_ringbuf_reserve(&kern_flow_events, sizeof(*ev), 0);
	if (!ev) {
		return 0;
	}

	ev->ts_ns = bpf_ktime_get_ns();
	__builtin_memcpy(&ev->saddr, ctx->saddr, sizeof(ev->saddr));
	__builtin_memcpy(&ev->daddr, ctx->daddr, sizeof(ev->daddr));
	ev->sport = ctx->sport;
	ev->dport = ctx->dport;
	ev->protocol = ctx->protocol;

	bpf_ringbuf_submit(ev, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
