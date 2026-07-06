package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	Group   = "kern.io"
	Version = "v1alpha1"
	Kind    = "KernMonitor"
)

// KernMonitor declares cluster-wide KERN agent deployment settings.
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
type KernMonitor struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   KernMonitorSpec   `json:"spec,omitempty"`
	Status KernMonitorStatus `json:"status,omitempty"`
}

type KernMonitorSpec struct {
	// Namespace for agent workloads (DaemonSet, Service, ServiceAccount).
	// +kubebuilder:default=kern
	Namespace string `json:"namespace,omitempty"`

	Agent KernAgentSpec `json:"agent"`
}

type KernAgentSpec struct {
	// Container image for the per-node KERN agent.
	// +kubebuilder:default="kern/agent:latest"
	Image string `json:"image,omitempty"`

	// Flow collection mode: auto, ebpf, proc, hubble.
	// +kubebuilder:default=auto
	Mode string `json:"mode,omitempty"`

	// Hubble relay address when mode is hubble.
	HubbleRelay string `json:"hubbleRelay,omitempty"`

	ImagePullPolicy string `json:"imagePullPolicy,omitempty"`

	// HTTP port exposed by the agent.
	// +kubebuilder:default=9474
	Port int32 `json:"port,omitempty"`
}

type KernMonitorStatus struct {
	Phase string `json:"phase,omitempty"`

	// Observed agent mode from the running DaemonSet.
	Mode string `json:"mode,omitempty"`

	NodesDesired int32 `json:"nodesDesired,omitempty"`
	NodesReady   int32 `json:"nodesReady,omitempty"`

	AgentService string `json:"agentService,omitempty"`

	Conditions []metav1.Condition `json:"conditions,omitempty"`

	Message string `json:"message,omitempty"`
}

// +kubebuilder:object:root=true
type KernMonitorList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []KernMonitor `json:"items"`
}

func (in *KernMonitor) DeepCopyInto(out *KernMonitor) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	out.Spec = in.Spec
	out.Status = in.Status
	out.Status.Conditions = copyConditions(in.Status.Conditions)
}

func (in *KernMonitor) DeepCopy() *KernMonitor {
	if in == nil {
		return nil
	}
	out := new(KernMonitor)
	in.DeepCopyInto(out)
	return out
}

func (in *KernMonitor) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

func (in *KernMonitorList) DeepCopyInto(out *KernMonitorList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]KernMonitor, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}

func (in *KernMonitorList) DeepCopy() *KernMonitorList {
	if in == nil {
		return nil
	}
	out := new(KernMonitorList)
	in.DeepCopyInto(out)
	return out
}

func (in *KernMonitorList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

func copyConditions(in []metav1.Condition) []metav1.Condition {
	if in == nil {
		return nil
	}
	out := make([]metav1.Condition, len(in))
	copy(out, in)
	return out
}
