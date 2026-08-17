package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrDisabled     = errors.New("demo authentication is disabled")
	ErrInvalidToken = errors.New("invalid or expired access token")
)

type User struct {
	ID            string   `json:"id"`
	Username      string   `json:"username"`
	DisplayName   string   `json:"displayName"`
	Email         string   `json:"email"`
	Phone         string   `json:"phone"`
	Status        string   `json:"status"`
	RoleIDs       []string `json:"roleIds"`
	RoleNames     []string `json:"roleNames"`
	ButtonAuths   []string `json:"btnAuths"`
	MenuIDs       []string `json:"menuIds"`
	DefaultRouter string   `json:"defaultRouter"`
}

type Claims struct {
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Email       string   `json:"email"`
	RoleIDs     []string `json:"roleIds"`
	RoleNames   []string `json:"roleNames"`
	jwt.RegisteredClaims
}

func (c Claims) User() User {
	return User{
		ID:            c.Subject,
		Username:      c.Username,
		DisplayName:   c.DisplayName,
		Email:         c.Email,
		Phone:         "",
		Status:        "active",
		RoleIDs:       c.RoleIDs,
		RoleNames:     c.RoleNames,
		ButtonAuths:   []string{},
		MenuIDs:       []string{},
		DefaultRouter: "/dashboard",
	}
}

type Config struct {
	Enabled  bool
	Username string
	Password string
	Secret   string
	Issuer   string
	TTL      time.Duration
	Now      func() time.Time
}

type Service struct {
	enabled  bool
	username string
	password string
	secret   []byte
	issuer   string
	ttl      time.Duration
	now      func() time.Time
}

func NewService(config Config) *Service {
	now := config.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		enabled:  config.Enabled,
		username: config.Username,
		password: config.Password,
		secret:   []byte(config.Secret),
		issuer:   config.Issuer,
		ttl:      config.TTL,
		now:      now,
	}
}

func (s *Service) Enabled() bool {
	return s != nil && s.enabled
}

func (s *Service) Authenticate(username, password string) (User, bool) {
	if !s.Enabled() {
		return User{}, false
	}
	usernameMatch := subtle.ConstantTimeCompare([]byte(username), []byte(s.username))
	passwordMatch := subtle.ConstantTimeCompare([]byte(password), []byte(s.password))
	if usernameMatch&passwordMatch != 1 {
		return User{}, false
	}

	return User{
		ID:            "fiber-demo-user",
		Username:      s.username,
		DisplayName:   "Fiber Demo User",
		Email:         s.username + "@goexample.local",
		Phone:         "",
		Status:        "active",
		RoleIDs:       []string{"demo"},
		RoleNames:     []string{"Demo"},
		ButtonAuths:   []string{},
		MenuIDs:       []string{},
		DefaultRouter: "/dashboard",
	}, true
}

func (s *Service) Issue(user User) (string, time.Time, error) {
	if !s.Enabled() {
		return "", time.Time{}, ErrDisabled
	}

	now := s.now().UTC()
	expiresAt := now.Add(s.ttl)
	tokenID, err := randomID()
	if err != nil {
		return "", time.Time{}, err
	}
	claims := Claims{
		Username:    user.Username,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		RoleIDs:     user.RoleIDs,
		RoleNames:   user.RoleNames,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   user.ID,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			NotBefore: jwt.NewNumericDate(now),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        tokenID,
		},
	}

	rawToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return rawToken, expiresAt, nil
}

func (s *Service) Verify(rawToken string) (Claims, error) {
	if !s.Enabled() {
		return Claims{}, ErrDisabled
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, ErrInvalidToken
			}
			return s.secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(s.issuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(5*time.Second),
		jwt.WithTimeFunc(s.now),
	)
	if err != nil || !token.Valid {
		return Claims{}, ErrInvalidToken
	}
	return *claims, nil
}

func randomID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}
