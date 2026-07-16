// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define AF_INET 2
#define IPPROTO_TCP 6

#define TCP_ESTABLISHED 1
#define TCP_SYN_SENT 2
#define TCP_CLOSE 7
#define TCP_CLOSE_WAIT 8
#define TCP_LAST_ACK 9
#define TCP_FIN_WAIT1 4
#define TCP_FIN_WAIT2 5
#define TCP_TIME_WAIT 6
#define TCP_CLOSING 11

#define FLOW_EVT_ESTABLISHED 1
#define FLOW_EVT_CLOSE 2
#define FLOW_EVT_TIMEOUT 3
#define FLOW_EVT_RESET 4
#define FLOW_EVT_RETRANSMIT 5

struct flow_tuple {
	__u32 saddr;
	__u32 daddr;
	__u16 sport;
	__u16 dport;
};

struct flow_event {
	__u64 ts_ns;
	__u32 saddr;
	__u32 daddr;
	__u16 sport;
	__u16 dport;
	__u8 protocol;
	__u8 event;
	__u8 old_state;
	__u8 new_state;
	__u32 retransmits;
	__u32 rtt_us;
	__u64 bytes_sent;
	__u64 bytes_received;
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 256 * 1024);
} kern_flow_events SEC(".maps");

struct {
	__uint(type, BPF_MAP_TYPE_LRU_HASH);
	__uint(max_entries, 16384);
	__type(key, struct flow_tuple);
	__type(value, __u64);
} syn_sent_ts SEC(".maps");

struct {
	__uint(type, BPF_MAP_TYPE_LRU_HASH);
	__uint(max_entries, 16384);
	__type(key, struct flow_tuple);
	__type(value, __u32);
} retrans_by_tuple SEC(".maps");

/* CO-RE field names — relocated against the running kernel's BTF. */
struct tcp_sock {
	__u64 bytes_received;
	__u64 bytes_sent;
	__u32 total_retrans;
	__u32 srtt_us;
} __attribute__((preserve_access_index));

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

struct trace_event_raw_tcp_retransmit_skb {
	__u64 unused;
	void *skbaddr;
	void *skaddr;
	int state;
	__u16 sport;
	__u16 dport;
	__u16 family;
	__u8 saddr[4];
	__u8 daddr[4];
	__u8 saddr_v6[16];
	__u8 daddr_v6[16];
};

static __always_inline void fill_tuple(struct flow_tuple *t, __u32 saddr, __u32 daddr, __u16 sport, __u16 dport)
{
	t->saddr = saddr;
	t->daddr = daddr;
	t->sport = sport;
	t->dport = dport;
}

static __always_inline void read_tcp_metrics(void *skaddr, __u64 *bytes_sent, __u64 *bytes_recv, __u32 *retrans, __u32 *rtt_us)
{
	*bytes_sent = 0;
	*bytes_recv = 0;
	*retrans = 0;
	*rtt_us = 0;
	if (!skaddr) {
		return;
	}

	struct tcp_sock *tp = (struct tcp_sock *)skaddr;
	*bytes_sent = BPF_CORE_READ(tp, bytes_sent);
	*bytes_recv = BPF_CORE_READ(tp, bytes_received);
	*retrans = BPF_CORE_READ(tp, total_retrans);
	__u32 srtt = BPF_CORE_READ(tp, srtt_us);
	*rtt_us = srtt ? (srtt >> 3) : 0;
}

static __always_inline int emit_flow(
	__u8 event,
	__u8 old_state,
	__u8 new_state,
	__u32 saddr,
	__u32 daddr,
	__u16 sport,
	__u16 dport,
	__u32 retransmits,
	__u32 rtt_us,
	__u64 bytes_sent,
	__u64 bytes_received)
{
	struct flow_event *ev = bpf_ringbuf_reserve(&kern_flow_events, sizeof(*ev), 0);
	if (!ev) {
		return 0;
	}

	__builtin_memset(ev, 0, sizeof(*ev));
	ev->ts_ns = bpf_ktime_get_ns();
	ev->saddr = saddr;
	ev->daddr = daddr;
	ev->sport = sport;
	ev->dport = dport;
	ev->protocol = IPPROTO_TCP;
	ev->event = event;
	ev->old_state = old_state;
	ev->new_state = new_state;
	ev->retransmits = retransmits;
	ev->rtt_us = rtt_us;
	ev->bytes_sent = bytes_sent;
	ev->bytes_received = bytes_received;
	bpf_ringbuf_submit(ev, 0);
	return 0;
}

SEC("tracepoint/sock/inet_sock_set_state")
int tp_inet_sock_set_state(struct trace_event_raw_inet_sock_set_state *ctx)
{
	if (ctx->family != AF_INET || ctx->protocol != IPPROTO_TCP) {
		return 0;
	}

	__u32 saddr = 0, daddr = 0;
	__builtin_memcpy(&saddr, ctx->saddr, sizeof(saddr));
	__builtin_memcpy(&daddr, ctx->daddr, sizeof(daddr));
	__u16 sport = ctx->sport;
	__u16 dport = ctx->dport;
	int oldstate = ctx->oldstate;
	int newstate = ctx->newstate;

	struct flow_tuple key = {};
	fill_tuple(&key, saddr, daddr, sport, dport);

	if (newstate == TCP_SYN_SENT) {
		__u64 now = bpf_ktime_get_ns();
		bpf_map_update_elem(&syn_sent_ts, &key, &now, BPF_ANY);
		return 0;
	}

	if (newstate == TCP_ESTABLISHED) {
		__u32 rtt_us = 0;
		__u64 *syn_ts = bpf_map_lookup_elem(&syn_sent_ts, &key);
		if (syn_ts) {
			__u64 delta = bpf_ktime_get_ns() - *syn_ts;
			rtt_us = (__u32)(delta / 1000ULL);
			if (rtt_us == 0) {
				rtt_us = 1;
			}
			bpf_map_delete_elem(&syn_sent_ts, &key);
		}

		__u32 retrans = 0;
		__u32 *rc = bpf_map_lookup_elem(&retrans_by_tuple, &key);
		if (rc) {
			retrans = *rc;
		}

		__u64 bytes_sent = 0, bytes_recv = 0;
		__u32 sock_retrans = 0, sock_rtt = 0;
		read_tcp_metrics(ctx->skaddr, &bytes_sent, &bytes_recv, &sock_retrans, &sock_rtt);
		if (sock_retrans > retrans) {
			retrans = sock_retrans;
		}
		if (sock_rtt && rtt_us == 0) {
			rtt_us = sock_rtt;
		}

		return emit_flow(FLOW_EVT_ESTABLISHED, (__u8)oldstate, (__u8)newstate,
				 saddr, daddr, sport, dport, retrans, rtt_us, bytes_sent, bytes_recv);
	}

	if (oldstate == TCP_SYN_SENT && newstate == TCP_CLOSE) {
		bpf_map_delete_elem(&syn_sent_ts, &key);
		__u32 retrans = 0;
		__u32 *rc = bpf_map_lookup_elem(&retrans_by_tuple, &key);
		if (rc) {
			retrans = *rc;
			bpf_map_delete_elem(&retrans_by_tuple, &key);
		}
		return emit_flow(FLOW_EVT_TIMEOUT, (__u8)oldstate, (__u8)newstate,
				 saddr, daddr, sport, dport, retrans, 0, 0, 0);
	}

	if (newstate == TCP_CLOSE || newstate == TCP_TIME_WAIT || newstate == TCP_CLOSE_WAIT ||
	    newstate == TCP_LAST_ACK || newstate == TCP_FIN_WAIT1 || newstate == TCP_FIN_WAIT2 ||
	    newstate == TCP_CLOSING) {
		if (oldstate != TCP_ESTABLISHED && oldstate != TCP_FIN_WAIT1 &&
		    oldstate != TCP_FIN_WAIT2 && oldstate != TCP_CLOSE_WAIT &&
		    oldstate != TCP_LAST_ACK && oldstate != TCP_CLOSING &&
		    oldstate != TCP_TIME_WAIT) {
			return 0;
		}

		__u64 bytes_sent = 0, bytes_recv = 0;
		__u32 sock_retrans = 0, sock_rtt = 0;
		read_tcp_metrics(ctx->skaddr, &bytes_sent, &bytes_recv, &sock_retrans, &sock_rtt);

		__u32 retrans = sock_retrans;
		__u32 *rc = bpf_map_lookup_elem(&retrans_by_tuple, &key);
		if (rc) {
			if (*rc > retrans) {
				retrans = *rc;
			}
			bpf_map_delete_elem(&retrans_by_tuple, &key);
		}
		bpf_map_delete_elem(&syn_sent_ts, &key);

		__u8 event = FLOW_EVT_CLOSE;
		if (oldstate == TCP_ESTABLISHED && newstate == TCP_CLOSE) {
			event = FLOW_EVT_RESET;
		}

		return emit_flow(event, (__u8)oldstate, (__u8)newstate,
				 saddr, daddr, sport, dport, retrans, sock_rtt, bytes_sent, bytes_recv);
	}

	return 0;
}

SEC("tracepoint/tcp/tcp_retransmit_skb")
int tp_tcp_retransmit_skb(struct trace_event_raw_tcp_retransmit_skb *ctx)
{
	if (ctx->family != AF_INET) {
		return 0;
	}

	__u32 saddr = 0, daddr = 0;
	__builtin_memcpy(&saddr, ctx->saddr, sizeof(saddr));
	__builtin_memcpy(&daddr, ctx->daddr, sizeof(daddr));

	struct flow_tuple key = {};
	fill_tuple(&key, saddr, daddr, ctx->sport, ctx->dport);

	__u32 next = 1;
	__u32 *count = bpf_map_lookup_elem(&retrans_by_tuple, &key);
	if (count) {
		next = *count + 1;
	}
	bpf_map_update_elem(&retrans_by_tuple, &key, &next, BPF_ANY);

	return emit_flow(FLOW_EVT_RETRANSMIT, (__u8)ctx->state, (__u8)ctx->state,
			 saddr, daddr, ctx->sport, ctx->dport, next, 0, 0, 0);
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
