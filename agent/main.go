package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

type ChannelPayload struct {
	ID          string                 `json:"id"`
	Title       string                 `json:"title"`
	Route       string                 `json:"route"`
	HasError    bool                   `json:"hasError"`
	Severity    string                 `json:"severity"`
	Fingerprint string                 `json:"fingerprint"`
	Attributes  map[string]interface{} `json:"attributes"`
	Breadcrumbs []interface{}          `json:"breadcrumbs"`
	DurationMs  int64                  `json:"durationMs"`
}

type Agent struct {
	mu           sync.Mutex
	buffer       []ChannelPayload
	hubURL       string
	apiKey       string
	apiSecret    string
	appendLogFile *os.File
}

func NewAgent(hubURL, apiKey, apiSecret string) (*Agent, error) {
	f, err := os.OpenFile("agent_buffer.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, err
	}
	return &Agent{
		hubURL:        hubURL,
		apiKey:        apiKey,
		apiSecret:     apiSecret,
		appendLogFile: f,
	}, nil
}

func (a *Agent) signPayload(data []byte) string {
	mac := hmac.New(sha256.New, []byte(a.apiSecret))
	mac.Write(data)
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *Agent) HandleIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Cannot read body", http.StatusBadRequest)
		return
	}

	var payload ChannelPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	a.mu.Lock()
	a.buffer = append(a.buffer, payload)
	// Write to append-only local log
	a.appendLogFile.Write(body)
	a.appendLogFile.WriteString("\n")
	a.mu.Unlock()

	log.Printf("[Agent] Buffered channel %s (route: %s, severity: %s, hasError: %v)", 
		payload.ID, payload.Route, payload.Severity, payload.HasError)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"buffered"}`))
}

func (a *Agent) StartFlusher(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			a.flushBuffer()
		}
	}()
}

func (a *Agent) flushBuffer() {
	a.mu.Lock()
	if len(a.buffer) == 0 {
		a.mu.Unlock()
		return
	}
	batch := a.buffer
	a.buffer = nil
	a.mu.Unlock()

	for _, item := range batch {
		data, _ := json.Marshal(item)
		req, err := http.NewRequest("POST", a.hubURL+"/api/v1/ingest", bytes.NewReader(data))
		if err != nil {
			log.Printf("[Agent] Failed to create request: %v", err)
			continue
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Pulse-Key", a.apiKey)
		req.Header.Set("X-Pulse-Signature", a.signPayload(data))

		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[Agent] Hub unreachable (%v). Retaining local log...", err)
			continue
		}
		resp.Body.Close()
		log.Printf("[Agent] Forwarded %s to central server -> HTTP %d", item.ID, resp.StatusCode)
	}
}

func main() {
	port := "4554"
	hubURL := "http://127.0.0.1:4555"
	if envHub := os.Getenv("PULSE_HUB_URL"); envHub != "" {
		hubURL = envHub
	}

	agent, err := NewAgent(hubURL, "pk_test_123", "secret_key_456")
	if err != nil {
		log.Fatalf("Failed to init agent: %v", err)
	}

	agent.StartFlusher(1 * time.Second)

	http.HandleFunc("/ingest", agent.HandleIngest)
	log.Printf("Pulse Go Agent daemon listening on http://127.0.0.1:%s (Forwarding to %s)", port, hubURL)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Agent server error: %v", err)
	}
}
