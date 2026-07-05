package k8s

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kern/agent/internal/store"
)

type PodRef struct {
	Name      string
	Namespace string
}

type ServiceRef struct {
	Name      string
	Namespace string
}

type Resolver struct {
	mu            sync.RWMutex
	byIP          map[string]PodRef
	serviceByIP   map[string]ServiceRef
	podToServices map[string][]ServiceRef
	clients       kubernetes.Interface
}

func NewResolver() (*Resolver, error) {
	config, err := restConfig()
	if err != nil {
		return nil, err
	}
	clients, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}
	return &Resolver{
		byIP:          make(map[string]PodRef),
		serviceByIP:   make(map[string]ServiceRef),
		podToServices: make(map[string][]ServiceRef),
		clients:       clients,
	}, nil
}

func NewNoopResolver() *Resolver {
	return &Resolver{
		byIP:          make(map[string]PodRef),
		serviceByIP:   make(map[string]ServiceRef),
		podToServices: make(map[string][]ServiceRef),
	}
}

func restConfig() (*rest.Config, error) {
	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	return clientcmd.BuildConfigFromFlags("", loadingRules.GetDefaultFilename())
}

func (r *Resolver) Start(ctx context.Context) error {
	if r.clients == nil {
		<-ctx.Done()
		return ctx.Err()
	}

	if err := r.seed(ctx); err != nil {
		log.Printf("resolver seed warning: %v", err)
	}

	factory := informers.NewSharedInformerFactory(r.clients, 30*time.Second)

	podInformer := factory.Core().V1().Pods().Informer()
	podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { r.indexPod(obj.(*corev1.Pod)) },
		UpdateFunc: func(_, obj interface{}) { r.indexPod(obj.(*corev1.Pod)) },
		DeleteFunc: func(obj interface{}) { r.removePod(obj.(*corev1.Pod)) },
	})

	svcInformer := factory.Core().V1().Services().Informer()
	svcInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { r.indexService(obj.(*corev1.Service)) },
		UpdateFunc: func(_, obj interface{}) { r.indexService(obj.(*corev1.Service)) },
		DeleteFunc: func(obj interface{}) { r.removeService(obj.(*corev1.Service)) },
	})

	epInformer := factory.Discovery().V1().EndpointSlices().Informer()
	epInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { r.indexEndpointSlice(obj.(*discoveryv1.EndpointSlice)) },
		UpdateFunc: func(_, obj interface{}) { r.indexEndpointSlice(obj.(*discoveryv1.EndpointSlice)) },
		DeleteFunc: func(obj interface{}) { r.removeEndpointSlice(obj.(*discoveryv1.EndpointSlice)) },
	})

	go factory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), podInformer.HasSynced, svcInformer.HasSynced, epInformer.HasSynced) {
		return context.Canceled
	}
	return nil
}

func (r *Resolver) seed(ctx context.Context) error {
	pods, err := r.clients.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return err
	}
	for i := range pods.Items {
		r.indexPod(&pods.Items[i])
	}

	services, err := r.clients.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return err
	}
	for i := range services.Items {
		r.indexService(&services.Items[i])
	}

	slices, err := r.clients.DiscoveryV1().EndpointSlices("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return err
	}
	for i := range slices.Items {
		r.indexEndpointSlice(&slices.Items[i])
	}
	return nil
}

func podKey(namespace, name string) string {
	return namespace + "/" + name
}

func (r *Resolver) indexPod(pod *corev1.Pod) {
	ip := pod.Status.PodIP
	if ip == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.byIP[ip] = PodRef{Name: pod.Name, Namespace: pod.Namespace}
}

func (r *Resolver) removePod(pod *corev1.Pod) {
	ip := pod.Status.PodIP
	r.mu.Lock()
	defer r.mu.Unlock()
	if ip != "" {
		delete(r.byIP, ip)
	}
	delete(r.podToServices, podKey(pod.Namespace, pod.Name))
}

func (r *Resolver) indexService(service *corev1.Service) {
	clusterIP := service.Spec.ClusterIP
	if clusterIP == "" || clusterIP == "None" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.serviceByIP[clusterIP] = ServiceRef{Name: service.Name, Namespace: service.Namespace}
}

func (r *Resolver) removeService(service *corev1.Service) {
	clusterIP := service.Spec.ClusterIP
	if clusterIP == "" || clusterIP == "None" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.serviceByIP, clusterIP)
}

func (r *Resolver) indexEndpointSlice(slice *discoveryv1.EndpointSlice) {
	serviceName := ""
	if slice.Labels != nil {
		serviceName = slice.Labels[discoveryv1.LabelServiceName]
	}
	if serviceName == "" {
		return
	}
	namespace := slice.Namespace
	if namespace == "" {
		namespace = "default"
	}
	serviceRef := ServiceRef{Name: serviceName, Namespace: namespace}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, endpoint := range slice.Endpoints {
		if endpoint.TargetRef != nil && endpoint.TargetRef.Kind == "Pod" {
			key := podKey(endpoint.TargetRef.Namespace, endpoint.TargetRef.Name)
			r.podToServices[key] = appendUniqueService(r.podToServices[key], serviceRef)
		}
		for _, addr := range endpoint.Addresses {
			if ref, ok := r.byIP[addr]; ok {
				key := podKey(ref.Namespace, ref.Name)
				r.podToServices[key] = appendUniqueService(r.podToServices[key], serviceRef)
			}
		}
	}
}

func appendUniqueService(existing []ServiceRef, ref ServiceRef) []ServiceRef {
	for _, item := range existing {
		if item.Name == ref.Name && item.Namespace == ref.Namespace {
			return existing
		}
	}
	return append(existing, ref)
}

func (r *Resolver) removeEndpointSlice(slice *discoveryv1.EndpointSlice) {
	serviceName := ""
	if slice.Labels != nil {
		serviceName = slice.Labels[discoveryv1.LabelServiceName]
	}
	if serviceName == "" {
		return
	}
	namespace := slice.Namespace
	if namespace == "" {
		namespace = "default"
	}
	serviceRef := ServiceRef{Name: serviceName, Namespace: namespace}

	r.mu.Lock()
	defer r.mu.Unlock()
	for key, services := range r.podToServices {
		filtered := services[:0]
		for _, item := range services {
			if item.Name != serviceRef.Name || item.Namespace != serviceRef.Namespace {
				filtered = append(filtered, item)
			}
		}
		if len(filtered) == 0 {
			delete(r.podToServices, key)
		} else {
			r.podToServices[key] = filtered
		}
	}
}

func (r *Resolver) Lookup(ip string) (PodRef, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ref, ok := r.byIP[ip]
	return ref, ok
}

func (r *Resolver) LookupService(ip string) (ServiceRef, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ref, ok := r.serviceByIP[ip]
	return ref, ok
}

func (r *Resolver) LookupServicesForPod(namespace, name string) []ServiceRef {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]ServiceRef(nil), r.podToServices[podKey(namespace, name)]...)
}

func (r *Resolver) Enrich(flow *store.Flow) {
	if ref, ok := r.Lookup(flow.SrcIP); ok {
		flow.SrcPod = ref.Name
		flow.SrcNamespace = ref.Namespace
	}
	if ref, ok := r.Lookup(flow.DstIP); ok {
		flow.DstPod = ref.Name
		flow.DstNamespace = ref.Namespace
	}

	if svc, ok := r.LookupService(flow.DstIP); ok {
		flow.DstService = svc.Name
		flow.DstServiceNamespace = svc.Namespace
	} else if flow.DstPod != "" {
		if services := r.LookupServicesForPod(flow.DstNamespace, flow.DstPod); len(services) > 0 {
			flow.DstService = services[0].Name
			flow.DstServiceNamespace = services[0].Namespace
		}
	}

	if svc, ok := r.LookupService(flow.SrcIP); ok {
		flow.SrcService = svc.Name
		flow.SrcServiceNamespace = svc.Namespace
	} else if flow.SrcPod != "" {
		if services := r.LookupServicesForPod(flow.SrcNamespace, flow.SrcPod); len(services) > 0 {
			flow.SrcService = services[0].Name
			flow.SrcServiceNamespace = services[0].Namespace
		}
	}

	flow.Path = buildPath(*flow)
}

func buildPath(flow store.Flow) string {
	parts := []string{}

	if flow.SrcPod != "" {
		parts = append(parts, fmt.Sprintf("%s/%s", flow.SrcPod, nsOrDefault(flow.SrcNamespace)))
	} else if flow.SrcIP != "" {
		parts = append(parts, flow.SrcIP)
	}

	if flow.DstService != "" {
		parts = append(parts, fmt.Sprintf("%s/%s", flow.DstService, nsOrDefault(flow.DstServiceNamespace)))
	}

	if flow.DstPod != "" {
		podPart := fmt.Sprintf("%s/%s", flow.DstPod, nsOrDefault(flow.DstNamespace))
		if flow.DstService == "" || podPart != fmt.Sprintf("%s/%s", flow.DstService, nsOrDefault(flow.DstServiceNamespace)) {
			parts = append(parts, podPart)
		}
	} else if flow.DstIP != "" && flow.DstService == "" {
		parts = append(parts, flow.DstIP)
	}

	return strings.Join(parts, " → ")
}

func nsOrDefault(namespace string) string {
	if namespace == "" {
		return "default"
	}
	return namespace
}

func (r *Resolver) PodCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.byIP)
}

func (r *Resolver) ServiceCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.serviceByIP)
}
