package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

const (
	AlertRuleKind = "KernAlertRule"
)

// KernAlertRule defines a declarative flow alert synced into the console runtime.
// +kubebuilder:object:root=true
type KernAlertRule struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec KernAlertRuleSpec `json:"spec,omitempty"`
}

type KernAlertRuleSpec struct {
	Enabled bool `json:"enabled,omitempty"`

	// latency | drop | timeout | silence | spike
	Type string `json:"type"`

	// warning | critical
	Severity string `json:"severity"`

	Threshold *AlertRuleThreshold `json:"threshold,omitempty"`
	Match     *AlertRuleMatch     `json:"match,omitempty"`

	Title string `json:"title,omitempty"`
	Cause string `json:"cause,omitempty"`
}

type AlertRuleThreshold struct {
	LatencyMs     *int32   `json:"latencyMs,omitempty"`
	SpikeFactor   *float64 `json:"spikeFactor,omitempty"`
	MinPriorFlows *int32   `json:"minPriorFlows,omitempty"`
}

type AlertRuleMatch struct {
	Namespace    string `json:"namespace,omitempty"`
	PathContains string `json:"pathContains,omitempty"`
	Verdict      string `json:"verdict,omitempty"`
}

// +kubebuilder:object:root=true
type KernAlertRuleList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []KernAlertRule `json:"items"`
}

func (in *KernAlertRule) DeepCopyInto(out *KernAlertRule) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	out.Spec = in.Spec
	if in.Spec.Threshold != nil {
		t := *in.Spec.Threshold
		out.Spec.Threshold = &t
	}
	if in.Spec.Match != nil {
		m := *in.Spec.Match
		out.Spec.Match = &m
	}
}

func (in *KernAlertRule) DeepCopy() *KernAlertRule {
	if in == nil {
		return nil
	}
	out := new(KernAlertRule)
	in.DeepCopyInto(out)
	return out
}

func (in *KernAlertRule) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

func (in *KernAlertRuleList) DeepCopyInto(out *KernAlertRuleList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]KernAlertRule, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}

func (in *KernAlertRuleList) DeepCopy() *KernAlertRuleList {
	if in == nil {
		return nil
	}
	out := new(KernAlertRuleList)
	in.DeepCopyInto(out)
	return out
}

func (in *KernAlertRuleList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}
