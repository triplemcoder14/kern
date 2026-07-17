// SPDX-License-Identifier: GPL-2.0 OR MIT
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define AF_INET 2
#define MAX_HTTP_PAYLOAD 512

#define HTTP_DIR_REQUEST 0
#define HTTP_DIR_RESPONSE 1

struct http_event {
	__u64 ts_ns;
	__u32 pid;
	__u32 saddr;
	__u32 daddr;
	__u16 sport;
	__u16 dport;
	__u8 direction; /* 0 = request, 1 = response */
	__u8 pad;
	__u16 payload_len;
	__u8 payload[MAX_HTTP_PAYLOAD];
} __attribute__((packed));

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 256 * 1024);
} kern_http_events SEC(".maps");

struct recv_pending {
	__u64 buff; /* recvfrom buffer or recvmsg msghdr* */
	__u64 addr;
	__u8 kind; /* 0 = recvfrom, 1 = recvmsg */
	__u8 pad[7];
};

struct {
	__uint(type, BPF_MAP_TYPE_HASH);
	__uint(max_entries, 8192);
	__type(key, __u64);
	__type(value, struct recv_pending);
} http_recv_by_pid SEC(".maps");

struct sockaddr_in_min {
	__u16 family;
	__u16 port;
	__u32 addr;
};

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

static __always_inline int looks_like_http(__u8 *hdr, __u32 n)
{
	if (n < 8) {
		return 0;
	}
	/* Requests */
	if (hdr[0] == 'G' && hdr[1] == 'E' && hdr[2] == 'T' && hdr[3] == ' ') {
		return 1;
	}
	if (hdr[0] == 'P' && hdr[1] == 'O' && hdr[2] == 'S' && hdr[3] == 'T' && hdr[4] == ' ') {
		return 1;
	}
	if (hdr[0] == 'P' && hdr[1] == 'U' && hdr[2] == 'T' && hdr[3] == ' ') {
		return 1;
	}
	if (hdr[0] == 'H' && hdr[1] == 'E' && hdr[2] == 'A' && hdr[3] == 'D' && hdr[4] == ' ') {
		return 1;
	}
	if (hdr[0] == 'D' && hdr[1] == 'E' && hdr[2] == 'L' && hdr[3] == 'E' && hdr[4] == 'T' &&
	    hdr[5] == 'E' && hdr[6] == ' ') {
		return 1;
	}
	if (hdr[0] == 'P' && hdr[1] == 'A' && hdr[2] == 'T' && hdr[3] == 'C' && hdr[4] == 'H' &&
	    hdr[5] == ' ') {
		return 1;
	}
	if (hdr[0] == 'O' && hdr[1] == 'P' && hdr[2] == 'T' && hdr[3] == 'I' && hdr[4] == 'O' &&
	    hdr[5] == 'N' && hdr[6] == 'S' && hdr[7] == ' ') {
		return 1;
	}
	/* Responses */
	if (hdr[0] == 'H' && hdr[1] == 'T' && hdr[2] == 'T' && hdr[3] == 'P' && hdr[4] == '/') {
		return 1;
	}
	return 0;
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
	if (!iov.iov_base || iov.iov_len < 8) {
		return 0;
	}
	*buff = (void *)iov.iov_base;
	*len = iov.iov_len;
	return 1;
}

static __always_inline int emit_http(
	void *buff,
	__u64 len,
	__u8 direction,
	__u32 saddr,
	__u32 daddr,
	__u16 sport,
	__u16 dport)
{
	__u32 copy_len = (__u32)len;
	if (copy_len < 8) {
		return 0;
	}
	if (copy_len > MAX_HTTP_PAYLOAD) {
		copy_len = MAX_HTTP_PAYLOAD;
	}
	copy_len &= 0x1ff;
	if (copy_len < 8) {
		return 0;
	}

	__u8 hdr[16] = {};
	__u32 hdr_n = copy_len;
	if (hdr_n > sizeof(hdr)) {
		hdr_n = sizeof(hdr);
	}
	if (bpf_probe_read_user(hdr, hdr_n, buff)) {
		return 0;
	}
	if (!looks_like_http(hdr, hdr_n)) {
		return 0;
	}

	struct http_event *ev = bpf_ringbuf_reserve(&kern_http_events, sizeof(*ev), 0);
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
	return emit_http((void *)ctx->buff, ctx->len, HTTP_DIR_REQUEST, 0, daddr, 0, have_sa ? dport : 0);
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
	__u16 dport = 0;
	int have_sa = 0;
	if (!bpf_probe_read_user(&hdr, sizeof(hdr), (void *)ctx->msg)) {
		read_sockaddr(hdr.msg_name, &daddr, &dport, &have_sa);
	}
	return emit_http(buff, len, HTTP_DIR_REQUEST, 0, daddr, 0, have_sa ? dport : 0);
}

SEC("tracepoint/syscalls/sys_enter_recvfrom")
int tp_sys_enter_recvfrom(struct sys_enter_recvfrom_args *ctx)
{
	if (!ctx->buff || ctx->len < 8) {
		return 0;
	}
	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending pending = {
		.buff = ctx->buff,
		.addr = ctx->addr,
		.kind = 0,
	};
	bpf_map_update_elem(&http_recv_by_pid, &pid, &pending, BPF_ANY);
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
	bpf_map_update_elem(&http_recv_by_pid, &pid, &pending, BPF_ANY);
	return 0;
}

SEC("tracepoint/syscalls/sys_exit_recvfrom")
int tp_sys_exit_recvfrom(struct sys_exit_recv_args *ctx)
{
	if (ctx->ret < 8 || ctx->ret > MAX_HTTP_PAYLOAD) {
		return 0;
	}
	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending *pending = bpf_map_lookup_elem(&http_recv_by_pid, &pid);
	if (!pending || pending->kind != 0) {
		return 0;
	}
	__u64 buff = pending->buff;
	__u64 addr = pending->addr;
	bpf_map_delete_elem(&http_recv_by_pid, &pid);

	__u32 saddr = 0;
	__u16 sport = 0;
	int have_sa = 0;
	read_sockaddr(addr, &saddr, &sport, &have_sa);
	return emit_http((void *)buff, (__u64)ctx->ret, HTTP_DIR_RESPONSE, saddr, 0, have_sa ? sport : 0, 0);
}

SEC("tracepoint/syscalls/sys_exit_recvmsg")
int tp_sys_exit_recvmsg(struct sys_exit_recv_args *ctx)
{
	if (ctx->ret < 8 || ctx->ret > MAX_HTTP_PAYLOAD) {
		return 0;
	}
	__u64 pid = bpf_get_current_pid_tgid();
	struct recv_pending *pending = bpf_map_lookup_elem(&http_recv_by_pid, &pid);
	if (!pending || pending->kind != 1) {
		return 0;
	}
	__u64 msg = pending->buff;
	bpf_map_delete_elem(&http_recv_by_pid, &pid);

	void *buff = 0;
	__u64 iov_len = 0;
	if (!read_iov_payload(msg, &buff, &iov_len)) {
		return 0;
	}
	struct user_msghdr_min hdr = {};
	__u32 saddr = 0;
	__u16 sport = 0;
	int have_sa = 0;
	if (!bpf_probe_read_user(&hdr, sizeof(hdr), (void *)msg)) {
		read_sockaddr(hdr.msg_name, &saddr, &sport, &have_sa);
	}
	__u64 copy_len = (__u64)ctx->ret;
	if (copy_len > iov_len) {
		copy_len = iov_len;
	}
	return emit_http(buff, copy_len, HTTP_DIR_RESPONSE, saddr, 0, have_sa ? sport : 0, 0);
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
