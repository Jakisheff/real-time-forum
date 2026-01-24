package handlers

import (
	"real-time-forum/internal/models"
)

type Handler struct {
	Users    *models.UserModel
	Sessions *models.SessionModel
	Posts    *models.PostModel
	Comments *models.CommentModel
}

func NewHandler(users *models.UserModel, sessions *models.SessionModel, posts *models.PostModel, comments *models.CommentModel) *Handler {
	return &Handler{
		Users:    users,
		Sessions: sessions,
		Posts:    posts,
		Comments: comments,
	}
}
