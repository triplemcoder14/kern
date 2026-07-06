/* Minimal vmlinux.h subset for bpf2go builds without kernel BTF on the build host.
 * CO-RE reads are not used; tracepoint args use a fixed layout struct in flows.c. */
#ifndef __VMLINUX_H__
#define __VMLINUX_H__

typedef unsigned char __u8;
typedef unsigned short __u16;
typedef unsigned int __u32;
typedef unsigned long long __u64;
typedef long long __s64;

#endif
