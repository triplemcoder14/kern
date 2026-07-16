// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define AF_INET 2
#define DNS_PORT 53
#define MAX_DNS_PAYLOAD 512

struct dns_event {
	__u64 ts_ns;
	__u32 pid;
	__u32 saddr;
	__u32 daddr;
	__u16 sport;
	__u16 dport;
	__u8 direction; /* 0 = outbound (query), 1 = inbound (response) */
	__u8 pad;
	__u16 payload_len;
	__u8 payload[MAX_DNS_PAYLOAD];
} __attribute__((packed));

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 256 * 1024);
} kern_dns_events SEC(".maps");

struct recv_pending {
	__u64 buff; /* direct buffer (recvfrom) or user_msghdr* (recvmsg) */
	__u64 addr; /* sockaddr* for recvfrom; unused for recvmsg */
	__u8 kind;  /* 0 = recvfrom, 1 = recvmsg */
	__u8 pad[7];
};

struct {
	__uint(type, BPF_MAP_TYPE_HASH);
	__uint(max_entries, 8192);
	__type(key, __u64);
	__type(value, struct recv_pending);
} recv_buf_by_pid SEC(".maps");

struct sockaddr_in_min {
	__u16 family;
	__u16 port; /* network order */
	__u32 addr;
};

/* Linux x86_64 / arm64 user_msghdr / iovec layouts */
struct user_msghdr_min {
	__u64 msg_name;
	__u32 msg_namelen;
	__u32 pad0;
	__u64 msg_iov;
	__u64 msg_iovlen;
};

struct iovec_min {
	__u64 iov_base;
	__u64 iov_len;
};

struct sys_enter_sendto_args {
	__u64 unused;
	__s32 __syscall_nr;
	__u64 fd;
	__u64 buff;
	__u64 len;
	__u64 flags;
	__u64 addr;
	__u64 addr_len;
};

struct sys_enter_recvfrom_args {
	__u64 unused;
	__s32 __syscall_nr;
	__u64 fd;
	__u64 buff;
	__u64 len;
	__u64 flags;
	__u64 addr;
	__u64 addr_len;
};

struct sys_exit_recv_args {
	__u64 unused;
	__s32 __syscall_nr;
	__s64 ret;
};

struct sys_enter_sendmsg_args {
	__u64 unused;
	__s32 __syscall_nr;
	__u64 fd;
	__u64 msg;
	__u64 flags;
};

struct sys_enter_recvmsg_args {
	__u64 unused;
	__s32 __syscall_nr;
	__u64 fd;
	__u64 msg;
	__u64 flags;
};

static __always_inline int looks_like_dns(__u8 *hdr)
{
	__u16 qd = ((__u16)hdr[4] << 8) | hdr[5];
	__u16 an = ((__u16)hdr[6] << 8) | hdr[7];
	if (qd == 0 || qd > 8) {
		return 0;
	}
	if (an > 64) {
		return 0;
	}
	if ((hdr[2] >> 3) & 0xF) {
		return 0;
	}
	return 1;
}

static __always_inline void read_sockaddr(__u64 addr_ptr, __u32 *ip, __u16 *port, int *ok)
{
	*ok = 0;
	if (!addr_ptr) {
		return;
	}
	struct sockaddr_in_min sa = {};
	if (bpf_probe_read_user(&sa, sizeof(sa), (void *)addr_ptr)) {
		return;
	}
	if (sa.family != AF_INET) {
		return;
	}
	*ip = sa.addr;
	*port = __builtin_bswap16(sa.port);
	*ok = 1;
}

static __always_inline int read_iov_payload(__u64 msg_ptr, void **buff, __u64 *len)
{
	struct user_msghdr_min hdr = {};
	struct iovec_min iov = {};

	if (!msg_ptr) {
		return 0;
	}
	if (bpf_probe_read_user(&hdr, sizeof(hdr), (void *)msg_ptr)) {
		return 0;
	}
	if (!hdr.msg_iov || hdr.msg_iovlen == 0) {
		return 0;
	}
	if (bpf_probe_read_user(&iov, sizeof(iov), (void *)hdr.msg_iov)) {
		return 0;
	}
	if (!iov.iov_base || iov.iov_len < 12) {
		return 0;
	}
	*buff = (void *)iov.iov_base;
	*len = iov.iov_len;
	return 1;
}

static __always_inline int emit_dns(
	void *buff,
	__u64 len,
	__u8 direction,
	__u32 saddr,
	__u32 daddr,
	__u16 sport,
	__u16 dport)
{
	__u32 copy_len = (__u32)len;
	if (copy_len < 12) {
		return 0;
	}
	if (copy_len > MAX_DNS_PAYLOAD) {
		copy_len = MAX_DNS_PAYLOAD;
	}
	/* Keep the verifier happy: force an unsigned upper bound. */
	copy_len &= 0x1ff; /* 0..511 */
	if (copy_len < 12) {
		return 0;
	}

	__u8 hdr[12];
	if (bpf_probe_read_user(hdr, sizeof(hdr), buff)) {
		return 0;
	}
	if (!looks_like_dns(hdr)) {
		return 0;
	}

	struct dns_event *ev = bpf_ringbuf_reserve(&kern_dns_events, sizeof(*ev), 0);
	if (!ev) {
		return 0;
	}

	__builtin_memset(ev, 0, sizeof(*ev));
	ev->ts_ns = bpf_ktime_get_ns();
	ev->pid = bpf_get_current_pid_tgid() >> 32;
	ev->saddr = saddr;
	ev->daddr = daddr;
	ev->sport = sport;
	ev->dport = dport;
	ev->direction = direction;
	ev->payload_len = (__u16)copy_len;

	if (bpf_probe_read_user(ev->payload, copy_len, buff)) {
		bpf_ringbuf_discard(ev, 0);
		return 0;
	}

	bpf_ringbuf_submit(ev, 0);
	return 0;
}

SEC("tracepoint/syscalls/sys_enter_sendto")
int tp_sys_enter_sendto(struct sys_enter_sendto_args *ctx)
{
	__u32 daddr = 0;
	__u16 dport = 0;
	int have_sa = 0;
	read_sockaddr(ctx->addr, &daddr, &dport, &have_sa);

	if (have_sa && dport != DNS_PORT) {
		return 0;
	}

	return emit_dns((void *)ctx->buff, ctx->len, 0, 0, daddr, 0, have_sa ? dport : DNS_PORT);
}

SEC("tracepoint/syscalls/sys_enter_sendmsg")
int tp_sys_enter_sendmsg(struct sys_enter_sendmsg_args *ctx)
{
	void *buff = 0;
	__u64 len = 0;
	if (!read_iov_payload(ctx->msg, &buff, &len)) {
		return 0;
	}

	struct user_msghdr_min hdr = {};
	__u32 daddr = 0;
	__u16 dport = DNS_PORT;
	int have_sa = 0;
	if (!bpf_probe_read_user(&hdr, sizeof(hdr), (void *)ctx->msg)) {
		read_sockaddr(hdr.msg_name, &daddr, &dport, &have_sa);
	}

	if (have_sa && dport != DNS_PORT) {
		return 0;
	}

	return emit_dns(buff, len, 0, 0, daddr, 0, have_sa ? dport : DNS_PORT);
}

SEC("tracepoint/syscalls/sys_enter_recvfrom")
int tp_sys_enter_recvfrom(struct sys_enter_recvfrom_args *ctx)
{
	if (!ctx->buff || ctx->len < 12) {
		return 0;
	}
	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending pending = {
		.buff = ctx->buff,
		.addr = ctx->addr,
		.kind = 0,
	};
	bpf_map_update_elem(&recv_buf_by_pid, &pid, &pending, BPF_ANY);
	return 0;
}

SEC("tracepoint/syscalls/sys_enter_recvmsg")
int tp_sys_enter_recvmsg(struct sys_enter_recvmsg_args *ctx)
{
	if (!ctx->msg) {
		return 0;
	}
	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending pending = {
		.buff = ctx->msg,
		.addr = 0,
		.kind = 1,
	};
	bpf_map_update_elem(&recv_buf_by_pid, &pid, &pending, BPF_ANY);
	return 0;
}

SEC("tracepoint/syscalls/sys_exit_recvfrom")
int tp_sys_exit_recvfrom(struct sys_exit_recv_args *ctx)
{
	if (ctx->ret < 12 || ctx->ret > MAX_DNS_PAYLOAD) {
		return 0;
	}

	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending *pending = bpf_map_lookup_elem(&recv_buf_by_pid, &pid);
	if (!pending || pending->kind != 0) {
		return 0;
	}

	__u64 buff = pending->buff;
	__u64 addr = pending->addr;
	bpf_map_delete_elem(&recv_buf_by_pid, &pid);

	__u32 saddr = 0;
	__u16 sport = DNS_PORT;
	int have_sa = 0;
	read_sockaddr(addr, &saddr, &sport, &have_sa);

	return emit_dns((void *)buff, (__u64)ctx->ret, 1, saddr, 0, have_sa ? sport : DNS_PORT, 0);
}

SEC("tracepoint/syscalls/sys_exit_recvmsg")
int tp_sys_exit_recvmsg(struct sys_exit_recv_args *ctx)
{
	if (ctx->ret < 12 || ctx->ret > MAX_DNS_PAYLOAD) {
		return 0;
	}

	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending *pending = bpf_map_lookup_elem(&recv_buf_by_pid, &pid);
	if (!pending || pending->kind != 1) {
		return 0;
	}

	__u64 msg = pending->buff;
	bpf_map_delete_elem(&recv_buf_by_pid, &pid);

	void *buff = 0;
	__u64 iov_len = 0;
	if (!read_iov_payload(msg, &buff, &iov_len)) {
		return 0;
	}

	struct user_msghdr_min hdr = {};
	__u32 saddr = 0;
	__u16 sport = DNS_PORT;
	int have_sa = 0;
	if (!bpf_probe_read_user(&hdr, sizeof(hdr), (void *)msg)) {
		read_sockaddr(hdr.msg_name, &saddr, &sport, &have_sa);
	}

	__u64 copy_len = (__u64)ctx->ret;
	if (copy_len > iov_len) {
		copy_len = iov_len;
	}

	return emit_dns(buff, copy_len, 1, saddr, 0, have_sa ? sport : DNS_PORT, 0);
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
