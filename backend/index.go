package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	minRating = 100
	maxRating = 5000
)

type User struct {
	ID       int
	Username string
}

type SeedUser struct {
	Username string
	Rating   int
}

type UsernameIndex struct {
	UsernameLower string
	ID            int
}

type LeaderboardEntry struct {
	Rank     int    `json:"rank"`
	Username string `json:"username"`
	Rating   int    `json:"rating"`
}

type LeaderboardResponse struct {
	UpdatedAt  string             `json:"updated_at"`
	TotalUsers int                `json:"total_users"`
	Page       int                `json:"page"`
	PageSize   int                `json:"page_size"`
	TotalPages int                `json:"total_pages"`
	Entries    []LeaderboardEntry `json:"entries"`
}

type SearchResponse struct {
	Query      string             `json:"query"`
	Count      int                `json:"count"`
	Total      int                `json:"total"`
	Page       int                `json:"page"`
	PageSize   int                `json:"page_size"`
	TotalPages int                `json:"total_pages"`
	Results    []LeaderboardEntry `json:"results"`
}

type Store struct {
	users         []User
	ratings       []int32
	usernameLower []string
	usernameIndex []UsernameIndex

	ratingCounts []int64
	totalUsers   int

	bucketMu      sync.Mutex
	ratingBuckets [][]int
	bucketIndex   []int

	lastUpdate atomic.Value
	snapshot   atomic.Value
}

type app struct {
	store   *Store
	handler http.Handler
}

var (
	appOnce     sync.Once
	appInstance *app
)

func getApp() *app {
	appOnce.Do(func() {
		appInstance = buildApp()
	})
	return appInstance
}

func Handler(w http.ResponseWriter, r *http.Request) {
	getApp().handler.ServeHTTP(w, r)
}

func NewStore(seeds []SeedUser) *Store {
	ratingRange := maxRating - minRating + 1
	store := &Store{
		users:         make([]User, len(seeds)),
		ratings:       make([]int32, len(seeds)),
		usernameLower: make([]string, len(seeds)),
		usernameIndex: make([]UsernameIndex, len(seeds)),
		ratingBuckets: make([][]int, ratingRange),
		bucketIndex:   make([]int, len(seeds)),
		ratingCounts:  make([]int64, ratingRange),
		totalUsers:    len(seeds),
	}

	for id, seed := range seeds {
		rating := clampRating(seed.Rating)
		store.users[id] = User{ID: id, Username: seed.Username}
		store.ratings[id] = int32(rating)
		store.usernameLower[id] = strings.ToLower(seed.Username)
		store.usernameIndex[id] = UsernameIndex{UsernameLower: store.usernameLower[id], ID: id}
		ratingIdx := rating - minRating
		store.bucketIndex[id] = len(store.ratingBuckets[ratingIdx])
		store.ratingBuckets[ratingIdx] = append(store.ratingBuckets[ratingIdx], id)
		atomic.AddInt64(&store.ratingCounts[ratingIdx], 1)
	}

	sort.Slice(store.usernameIndex, func(i, j int) bool {
		if store.usernameIndex[i].UsernameLower == store.usernameIndex[j].UsernameLower {
			return store.usernameIndex[i].ID < store.usernameIndex[j].ID
		}
		return store.usernameIndex[i].UsernameLower < store.usernameIndex[j].UsernameLower
	})

	store.lastUpdate.Store(time.Now())
	store.snapshot.Store([]int{})

	return store
}

func (s *Store) UserCount() int {
	return s.totalUsers
}

func (s *Store) LastUpdate() time.Time {
	value := s.lastUpdate.Load()
	if value == nil {
		return time.Time{}
	}
	return value.(time.Time)
}

func (s *Store) rank(rating int) int {
	rating = clampRating(rating)
	above := int64(0)
	for current := rating + 1; current <= maxRating; current++ {
		above += atomic.LoadInt64(&s.ratingCounts[current-minRating])
	}
	return int(above) + 1
}

func (s *Store) buildSnapshot() []int {
	snapshot := make([]int, 0, s.totalUsers)

	s.bucketMu.Lock()
	defer s.bucketMu.Unlock()

	for rating := maxRating; rating >= minRating; rating-- {
		bucket := s.ratingBuckets[rating-minRating]
		if len(bucket) == 0 {
			continue
		}

		ids := bucket
		if len(bucket) > 1 {
			ids = append([]int(nil), bucket...)
			sort.Slice(ids, func(i, j int) bool {
				return s.usernameLower[ids[i]] < s.usernameLower[ids[j]]
			})
		}
		snapshot = append(snapshot, ids...)
	}

	return snapshot
}

func (s *Store) RefreshSnapshot() {
	s.snapshot.Store(s.buildSnapshot())
}

func (s *Store) SnapshotIDs() []int {
	value := s.snapshot.Load()
	if value == nil {
		return nil
	}
	return value.([]int)
}

func (s *Store) LeaderboardPage(page int, limit int) []LeaderboardEntry {
	if limit <= 0 {
		limit = 20
	}
	if page <= 0 {
		page = 1
	}
	snapshot := s.SnapshotIDs()
	if len(snapshot) == 0 {
		return nil
	}

	offset := (page - 1) * limit
	if offset >= len(snapshot) {
		return nil
	}
	end := offset + limit
	if end > len(snapshot) {
		end = len(snapshot)
	}

	results := make([]LeaderboardEntry, 0, end-offset)
	for _, id := range snapshot[offset:end] {
		rating := int(atomic.LoadInt32(&s.ratings[id]))
		results = append(results, LeaderboardEntry{
			Rank:     s.rank(rating),
			Username: s.users[id].Username,
			Rating:   rating,
		})
	}

	return results
}

func (s *Store) StartSnapshotLoop(ctx context.Context, tickMs int) {
	if tickMs <= 0 {
		return
	}
	ticker := time.NewTicker(time.Duration(tickMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.RefreshSnapshot()
		}
	}
}

func (s *Store) SearchPage(prefix string, page int, limit int) ([]LeaderboardEntry, int, int, int) {
	if limit <= 0 {
		limit = 20
	}
	if page <= 0 {
		page = 1
	}
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	if prefix == "" {
		return nil, 0, page, 0
	}

	start := sort.Search(len(s.usernameIndex), func(i int) bool {
		return s.usernameIndex[i].UsernameLower >= prefix
	})
	prefixHigh := prefix + "\xff"
	end := sort.Search(len(s.usernameIndex), func(i int) bool {
		return s.usernameIndex[i].UsernameLower >= prefixHigh
	})
	total := end - start
	totalPages := calcTotalPages(total, limit)
	page = clampPage(page, totalPages)
	if total == 0 {
		return nil, 0, page, totalPages
	}

	offset := (page - 1) * limit
	startIdx := start + offset
	if startIdx >= end {
		return nil, total, page, totalPages
	}
	endIdx := startIdx + limit
	if endIdx > end {
		endIdx = end
	}

	results := make([]LeaderboardEntry, 0, endIdx-startIdx)
	for i := startIdx; i < endIdx; i++ {
		id := s.usernameIndex[i].ID
		rating := int(atomic.LoadInt32(&s.ratings[id]))
		results = append(results, LeaderboardEntry{
			Rank:     s.rank(rating),
			Username: s.users[id].Username,
			Rating:   rating,
		})
	}

	return results, total, page, totalPages
}

func (s *Store) updateUserRating(id int, newRating int) {
	oldRating := int(atomic.LoadInt32(&s.ratings[id]))
	if oldRating == newRating {
		return
	}

	oldBucketIdx := oldRating - minRating
	newBucketIdx := newRating - minRating

	s.bucketMu.Lock()
	oldBucket := s.ratingBuckets[oldBucketIdx]
	oldPos := s.bucketIndex[id]
	lastID := oldBucket[len(oldBucket)-1]
	oldBucket[oldPos] = lastID
	s.bucketIndex[lastID] = oldPos
	oldBucket = oldBucket[:len(oldBucket)-1]
	s.ratingBuckets[oldBucketIdx] = oldBucket

	newBucket := s.ratingBuckets[newBucketIdx]
	s.bucketIndex[id] = len(newBucket)
	newBucket = append(newBucket, id)
	s.ratingBuckets[newBucketIdx] = newBucket

	atomic.AddInt64(&s.ratingCounts[oldBucketIdx], -1)
	atomic.AddInt64(&s.ratingCounts[newBucketIdx], 1)
	s.bucketMu.Unlock()

	atomic.StoreInt32(&s.ratings[id], int32(newRating))
}

func (s *Store) StartRandomUpdates(ctx context.Context, updatesPerTick int, tickMs int) {
	if updatesPerTick <= 0 || tickMs <= 0 {
		return
	}

	source := rand.New(rand.NewSource(time.Now().UnixNano()))
	ticker := time.NewTicker(time.Duration(tickMs) * time.Millisecond)
	defer ticker.Stop()

	type update struct {
		id    int
		delta int
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			batch := make([]update, updatesPerTick)
			for i := 0; i < updatesPerTick; i++ {
				batch[i] = update{
					id:    source.Intn(len(s.users)),
					delta: source.Intn(101) - 50,
				}
			}

			changed := false
			for _, item := range batch {
				oldRating := int(atomic.LoadInt32(&s.ratings[item.id]))
				newRating := clampRating(oldRating + item.delta)
				if newRating != oldRating {
					s.updateUserRating(item.id, newRating)
					changed = true
				}
			}
			if changed {
				s.lastUpdate.Store(time.Now())
			}
		}
	}
}

func generateUsers(count int) []SeedUser {
	if count < 10000 {
		count = 10000
	}

	names := []string{
		"rahul", "aarav", "arjun", "isha", "kavya", "neha", "vivek", "meera", "saanvi", "anaya",
		"alex", "maria", "liam", "olivia", "noah", "emma", "ethan", "ava", "mia", "logan",
	}
	nouns := []string{"nova", "atlas", "pixel", "ember", "quill", "ridge", "spark", "zen", "orbit", "flux"}

	source := rand.New(rand.NewSource(time.Now().UnixNano()))
	seen := make(map[string]bool, count)
	users := make([]SeedUser, 0, count)

	addUser := func(username string) {
		if seen[username] {
			return
		}
		seen[username] = true
		rating := source.Intn(maxRating-minRating+1) + minRating
		users = append(users, SeedUser{
			Username: username,
			Rating:   rating,
		})
	}

	addUserWithRating := func(username string, rating int) {
		if seen[username] {
			return
		}
		seen[username] = true
		users = append(users, SeedUser{
			Username: username,
			Rating:   clampRating(rating),
		})
	}

	specials := []struct {
		name   string
		rating int
	}{
		{name: "rahul", rating: 4600},
		{name: "rahul_burman", rating: 3900},
		{name: "rahul_mathur", rating: 3900},
		{name: "rahul_kumar", rating: 1234},
	}
	for _, item := range specials {
		addUserWithRating(item.name, item.rating)
	}
	addUser("rahul_jain")
	addUser("rahul_sen")

	for i := 1; i <= 200; i++ {
		addUser(fmt.Sprintf("rahul_%03d", i))
	}

	target := count + len(users)
	for len(users) < target {
		name := names[source.Intn(len(names))]
		noun := nouns[source.Intn(len(nouns))]
		suffix := source.Intn(9999)
		username := fmt.Sprintf("%s_%s_%04d", name, noun, suffix)
		addUser(username)
	}

	return users
}

func buildApp() *app {
	seedUsers := getEnvInt("SEED_USERS", 10000)
	updatesPerTick := getEnvInt("UPDATES_PER_TICK", 200)
	tickMs := getEnvInt("TICK_MS", 200)
	snapshotMs := getEnvInt("SNAPSHOT_MS", 1000)

	seeds := generateUsers(seedUsers)
	store := NewStore(seeds)
	store.RefreshSnapshot()

	ctx := context.Background()
	go store.StartRandomUpdates(ctx, updatesPerTick, tickMs)
	go store.StartSnapshotLoop(ctx, snapshotMs)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "backend running"})
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/leaderboard", func(w http.ResponseWriter, r *http.Request) {
		page := getQueryInt(r, "page", 1)
		limit := getQueryInt(r, "limit", 20)
		if limit <= 0 {
			limit = 20
		}
		if limit > 200 {
			limit = 200
		}
		totalUsers := store.UserCount()
		totalPages := calcTotalPages(totalUsers, limit)
		page = clampPage(page, totalPages)
		response := LeaderboardResponse{
			UpdatedAt:  store.LastUpdate().UTC().Format(time.RFC3339),
			TotalUsers: totalUsers,
			Page:       page,
			PageSize:   limit,
			TotalPages: totalPages,
			Entries:    store.LeaderboardPage(page, limit),
		}
		writeJSON(w, http.StatusOK, response)
	})
	mux.HandleFunc("/search", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		if query == "" {
			query = r.URL.Query().Get("q")
		}
		page := getQueryInt(r, "page", 1)
		limit := getQueryInt(r, "limit", 20)
		if limit <= 0 {
			limit = 20
		}
		if limit > 200 {
			limit = 200
		}
		results, total, pageOut, totalPages := store.SearchPage(query, page, limit)
		response := SearchResponse{
			Query:      query,
			Count:      len(results),
			Total:      total,
			Page:       pageOut,
			PageSize:   limit,
			TotalPages: totalPages,
			Results:    results,
		}
		writeJSON(w, http.StatusOK, response)
	})

	handler := withCORS(stripAPIPrefix(mux))

	return &app{
		store:   store,
		handler: handler,
	}
}

func StartServer() error {
	port := getEnvString("PORT", "8080")
	app := getApp()

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           app.handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("leaderboard server running on :%s (users=%d)\n", port, app.store.UserCount())
	if err := server.ListenAndServe(); err != nil && !strings.Contains(err.Error(), "Server closed") {
		return err
	}
	return nil
}

func clampRating(value int) int {
	if value < minRating {
		return minRating
	}
	if value > maxRating {
		return maxRating
	}
	return value
}

func calcTotalPages(total int, limit int) int {
	if total <= 0 || limit <= 0 {
		return 0
	}
	return (total + limit - 1) / limit
}

func clampPage(page int, totalPages int) int {
	if page < 1 {
		page = 1
	}
	if totalPages > 0 && page > totalPages {
		page = totalPages
	}
	return page
}

func getEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvString(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getQueryInt(r *http.Request, key string, fallback int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		requestHeaders := r.Header.Get("Access-Control-Request-Headers")
		if requestHeaders == "" {
			requestHeaders = "*"
		}
		w.Header().Set("Access-Control-Allow-Headers", requestHeaders)
		requestMethod := r.Header.Get("Access-Control-Request-Method")
		if requestMethod == "" {
			requestMethod = "GET, OPTIONS"
		}
		w.Header().Set("Access-Control-Allow-Methods", requestMethod)
		w.Header().Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func stripAPIPrefix(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			clone := r.Clone(r.Context())
			trimmed := strings.TrimPrefix(clone.URL.Path, "/api")
			if trimmed == "" {
				trimmed = "/"
			}
			clone.URL.Path = trimmed
			next.ServeHTTP(w, clone)
			return
		}
		next.ServeHTTP(w, r)
	})
}
