package chat

import (
	"encoding/json"
	"log"
	"net/http"
	"real-time-forum/internal/models"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

var Upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins for simplicity in this project
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	Hub *Hub

	// The websocket connection.
	Conn *websocket.Conn

	// Buffered channel of outbound messages.
	Send chan []byte

	UserID   int
	Nickname string

	// Access to DB to save messages
	MsgModel *models.MessageModel
}

// ReadPump pumps messages from the websocket connection to the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()
	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error { c.Conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		// Parse message to ensure validity and Save to DB
		var payload struct {
			Type       string `json:"type"`
			ReceiverID int    `json:"receiver_id"`
			Content    string `json:"content"`
		}

		if err := json.Unmarshal(message, &payload); err != nil {
			log.Printf("Invalid JSON: %v", err)
			continue
		}

		if payload.Type == "message" {
			// Save to DB
			msg := &models.Message{
				SenderID:   c.UserID,
				ReceiverID: payload.ReceiverID,
				Content:    payload.Content,
			}

			if err := c.MsgModel.Save(msg); err != nil {
				log.Printf("Failed to save message: %v", err)
				continue
			}

			// Re-marshal with metadata (like SenderID and Timestamp) to send to Hub
			outgoingMsg := struct {
				Type       string `json:"type"`
				SenderID   int    `json:"sender_id"`
				ReceiverID int    `json:"receiver_id"`
				Content    string `json:"content"`
				Timestamp  string `json:"timestamp"`
			}{
				Type:       "message",
				SenderID:   c.UserID,
				ReceiverID: payload.ReceiverID,
				Content:    payload.Content,
				Timestamp:  time.Now().Format(time.RFC3339),
			}

			bytes, _ := json.Marshal(outgoingMsg)

			// Send to Hub for routing
			c.Hub.Broadcast <- bytes

			// Also send back to sender so they see it instantly (or rely on frontend optimistic UI)
			// But for consistency, let's echo it back via the write pump loop or just let frontend handle it.
			// Let's send it to the 'Sender' via the hub routing logic?
			// Actually, the Hub routing logic I wrote only sends to Receiver.
			// Let's manually send to self here to confirm delivery.
			//c.Send <- bytes
		}
	}
}

// WritePump pumps messages from the hub to the websocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued chat messages to the current websocket message.
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
