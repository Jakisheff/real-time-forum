package chat

import (
	"encoding/json"
	"log"
	"sync"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	// Registered clients map[UserID] -> Client
	Clients map[int]*Client

	// Inbound messages from the clients.
	Broadcast chan []byte

	// Register requests from the clients.
	Register chan *Client

	// Unregister requests from clients.
	Unregister chan *Client

	// Mutex for safe map access
	Mu sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[int]*Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Mu.Lock()
			h.Clients[client.UserID] = client
			h.Mu.Unlock()
			h.broadcastUserStatus(client.UserID, true)
			log.Printf("User %d connected", client.UserID)

		case client := <-h.Unregister:
			h.Mu.Lock()
			if _, ok := h.Clients[client.UserID]; ok {
				delete(h.Clients, client.UserID)
				close(client.Send)
			}
			h.Mu.Unlock()
			h.broadcastUserStatus(client.UserID, false)
			log.Printf("User %d disconnected", client.UserID)

		case message := <-h.Broadcast:
			// Parse message to find receiver
			// This expects a JSON payload with 'type' and 'receiver_id'
			// For simple routing.
			// However, the Client.ReadPump typically handles DB saving
			// and then passes the raw bytes here.
			// We need to decode to know WHO to send to.

			var payload struct {
				Type       string `json:"type"`
				ReceiverID int    `json:"receiver_id"`
			}
			json.Unmarshal(message, &payload)

			if payload.Type == "message" && payload.ReceiverID != 0 {
				h.Mu.Lock()
				receiver, ok := h.Clients[payload.ReceiverID]
				h.Mu.Unlock()
				if ok {
					select {
					case receiver.Send <- message:
					default:
						// If receiver buffer is full, drop
						h.Mu.Lock()
						close(receiver.Send)
						delete(h.Clients, payload.ReceiverID)
						h.Mu.Unlock()
					}
				}
			}
		}
	}
}

func (h *Hub) broadcastUserStatus(userID int, online bool) {
	msg := struct {
		Type   string `json:"type"`
		UserID int    `json:"user_id"`
		Online bool   `json:"online"`
	}{
		Type:   "status",
		UserID: userID,
		Online: online,
	}

	data, _ := json.Marshal(msg)

	h.Mu.Lock()
	defer h.Mu.Unlock()
	for _, client := range h.Clients {
		select {
		case client.Send <- data:
		default:
			close(client.Send)
			delete(h.Clients, client.UserID)
		}
	}
}
