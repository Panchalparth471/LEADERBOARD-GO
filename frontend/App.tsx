import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  useFonts,
} from "@expo-google-fonts/space-grotesk";

const resolveApiUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (typeof scriptURL === "string") {
    const match = scriptURL.match(/https?:\/\/([^:/]+)/);
    if (match?.[1]) {
      return `http://${match[1]}:8080`;
    }
  }
  if (Platform.OS === "android") {
    return "https://leaderboard-go.vercel.app";
  }
  return "http://localhost:8080";
};

const API_URL = resolveApiUrl();

const LEADERBOARD_PAGE_SIZE = 20;
const SEARCH_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 4500;

const fetchWithTimeout = async (
  url: string,
  options?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

type Entry = {
  rank: number;
  username: string;
  rating: number;
};

type LeaderboardResponse = {
  updated_at: string;
  total_users: number;
  page: number;
  page_size: number;
  total_pages: number;
  entries: Entry[];
};

type SearchResponse = {
  query: string;
  count: number;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: Entry[];
};

const formatNumber = (value: number) => {
  try {
    return new Intl.NumberFormat().format(value);
  } catch {
    return String(value);
  }
};

const formatRange = (page: number, pageSize: number, total: number) => {
  if (total <= 0 || pageSize <= 0) {
    return `0 of ${formatNumber(total)}`;
  }
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize + 1;
  if (start > total) {
    return `0 of ${formatNumber(total)}`;
  }
  const end = Math.min(safePage * pageSize, total);
  return `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(total)}`;
};

const formatTime = (value: string) => {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString();
};

const EntryRow = ({ entry }: { entry: Entry }) => (
  <View style={styles.row}>
    <View style={styles.rankPill}>
      <Text style={styles.rankText}>{entry.rank}</Text>
    </View>
    <Text style={styles.username} numberOfLines={1}>
      {entry.username}
    </Text>
    <Text style={styles.rating}>{entry.rating}</Text>
  </View>
);

type PaginationProps = {
  page: number;
  totalPages: number;
  label: string;
  onPrev: () => void;
  onNext: () => void;
};

const Pagination = ({
  page,
  totalPages,
  label,
  onPrev,
  onNext,
}: PaginationProps) => (
  <View style={styles.paginationRow}>
    <Pressable
      style={[
        styles.paginationButton,
        page <= 1 && styles.paginationButtonDisabled,
      ]}
      onPress={onPrev}
      disabled={page <= 1}
    >
      <Text style={styles.paginationButtonText}>Prev</Text>
    </Pressable>
    <Text style={styles.paginationLabel}>{label}</Text>
    <Pressable
      style={[
        styles.paginationButton,
        page >= totalPages && styles.paginationButtonDisabled,
      ]}
      onPress={onNext}
      disabled={page >= totalPages}
    >
      <Text style={styles.paginationButtonText}>Next</Text>
    </Pressable>
  </View>
);

export default function App() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  const [leaderboard, setLeaderboard] = useState<Entry[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [boardPage, setBoardPage] = useState(1);
  const [boardTotalPages, setBoardTotalPages] = useState(0);
  const [boardPageSize, setBoardPageSize] = useState(LEADERBOARD_PAGE_SIZE);
  const hasLeaderboardRef = useRef(false);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequest = useRef(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchTotalPages, setSearchTotalPages] = useState(0);
  const [searchPageSize, setSearchPageSize] = useState(SEARCH_PAGE_SIZE);
  const lastQueryRef = useRef("");

  const totalUsersLabel = totalUsers > 0 ? formatNumber(totalUsers) : "--";
  const resolvedBoardPageSize =
    boardPageSize > 0 ? boardPageSize : LEADERBOARD_PAGE_SIZE;
  const resolvedBoardTotalPages =
    boardTotalPages > 0
      ? boardTotalPages
      : totalUsers > 0
      ? Math.ceil(totalUsers / resolvedBoardPageSize)
      : 0;
  const boardPageSafe = Math.min(boardPage, Math.max(resolvedBoardTotalPages, 1));
  const boardRangeLabel = formatRange(
    boardPageSafe,
    resolvedBoardPageSize,
    totalUsers
  );
  const resolvedSearchPageSize =
    searchPageSize > 0 ? searchPageSize : SEARCH_PAGE_SIZE;
  const resolvedSearchTotal = searchTotal > 0 ? searchTotal : searchResults.length;
  const resolvedSearchTotalPages =
    searchTotalPages > 0
      ? searchTotalPages
      : resolvedSearchTotal > 0
      ? Math.ceil(resolvedSearchTotal / resolvedSearchPageSize)
      : 0;
  const searchPageSafe = Math.min(
    searchPage,
    Math.max(resolvedSearchTotalPages, 1)
  );
  const searchRangeLabel = formatRange(
    searchPageSafe,
    resolvedSearchPageSize,
    resolvedSearchTotal
  );

  const headerAnim = useRef(new Animated.Value(0)).current;
  const searchAnim = useRef(new Animated.Value(0)).current;
  const boardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!fontsLoaded) return;
    Animated.stagger(140, [
      Animated.timing(headerAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(searchAnim, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(boardAnim, {
        toValue: 1,
        duration: 560,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fontsLoaded, headerAnim, searchAnim, boardAnim]);

  useEffect(() => {
    let active = true;

    const loadLeaderboard = async () => {
      try {
        if (!hasLeaderboardRef.current) {
          setLeaderboardLoading(true);
        }
        const res = await fetchWithTimeout(
          `${API_URL}/leaderboard?limit=${LEADERBOARD_PAGE_SIZE}&page=${boardPage}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: LeaderboardResponse = await res.json();
        if (!active) return;
        const entries = data.entries ?? [];
        setLeaderboard(entries);
        setTotalUsers(data.total_users ?? 0);
        setUpdatedAt(data.updated_at ?? "");
        const pageSize = data.page_size ?? LEADERBOARD_PAGE_SIZE;
        const totalPages = data.total_pages ?? 0;
        setBoardPageSize(pageSize);
        setBoardTotalPages(totalPages);
        if (data.page && data.page !== boardPage) {
          setBoardPage(data.page);
        }
        hasLeaderboardRef.current = true;
        setLeaderboardError(null);
      } catch (err) {
        if (!active) return;
        const timeout =
          err instanceof Error && err.name === "AbortError"
            ? " Request timed out."
            : "";
        setLeaderboardError(
          `Could not load leaderboard from ${API_URL}.${timeout}`
        );
      } finally {
        if (active) setLeaderboardLoading(false);
      }
    };

    loadLeaderboard();
    const interval = setInterval(loadLeaderboard, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [boardPage]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      lastQueryRef.current = "";
      setSearchResults([]);
      setSearchTotal(0);
      setSearchTotalPages(0);
      setSearchError(null);
      setSearchLoading(false);
      setSearchPage(1);
      return;
    }

    if (trimmed !== lastQueryRef.current) {
      lastQueryRef.current = trimmed;
      if (searchPage !== 1) {
        setSearchPage(1);
        return;
      }
    }

    setSearchLoading(true);
    const requestId = ++searchRequest.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(
          `${API_URL}/search?query=${encodeURIComponent(
            trimmed
          )}&limit=${SEARCH_PAGE_SIZE}&page=${searchPage}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: SearchResponse = await res.json();
        if (requestId !== searchRequest.current) return;
        const results = data.results ?? [];
        setSearchResults(results);
        setSearchTotal(data.total ?? 0);
        setSearchTotalPages(data.total_pages ?? 0);
        setSearchPageSize(data.page_size ?? SEARCH_PAGE_SIZE);
        if (data.page && data.page !== searchPage) {
          setSearchPage(data.page);
        }
        setSearchError(null);
      } catch (err) {
        if (requestId !== searchRequest.current) return;
        const timeout =
          err instanceof Error && err.name === "AbortError"
            ? " Request timed out."
            : "";
        setSearchError(`Search failed on ${API_URL}.${timeout}`);
      } finally {
        if (requestId === searchRequest.current) setSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, searchPage]);

  const headerStyle = useMemo(
    () => ({
      opacity: headerAnim,
      transform: [
        {
          translateY: headerAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [14, 0],
          }),
        },
      ],
    }),
    [headerAnim]
  );

  const searchStyle = useMemo(
    () => ({
      opacity: searchAnim,
      transform: [
        {
          translateY: searchAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          }),
        },
      ],
    }),
    [searchAnim]
  );

  const boardStyle = useMemo(
    () => ({
      opacity: boardAnim,
      transform: [
        {
          translateY: boardAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
      ],
    }),
    [boardAnim]
  );

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={palette.ink} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <RNStatusBar barStyle="dark-content" />
      <LinearGradient
        colors={[palette.bgTop, palette.bgMid, palette.bgBottom]}
        style={styles.background}
      >
        <View style={styles.orbOne} />
        <View style={styles.orbTwo} />
        <View style={styles.orbThree} />

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Animated.View style={[styles.headerCard, headerStyle]}>
            <Text style={styles.title}>Matiks Live Leaderboard</Text>
            <Text style={styles.subtitle}>
              Real-time ranks with tie accuracy and instant lookups.
            </Text>
            <View style={styles.metaRow}>
              <View style={styles.metaPill}>
                <Text style={styles.metaLabel}>Users</Text>
                <Text style={styles.metaValue}>{totalUsersLabel}</Text>
              </View>
              <View style={styles.metaPill}>
                <Text style={styles.metaLabel}>Updated</Text>
                <Text style={styles.metaValue}>{formatTime(updatedAt)}</Text>
              </View>
            </View>
          </Animated.View>

          <Animated.View style={[styles.section, searchStyle]}>
            <BlurView intensity={20} tint="light" style={styles.card}>
              <Text style={styles.sectionTitle}>User Search</Text>
              <Text style={styles.sectionHint}>
                Prefix search, live global rank included.
              </Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search username (e.g. rahul)"
                placeholderTextColor={palette.inkMuted}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchLoading && (
                <View style={styles.inlineRow}>
                  <ActivityIndicator size="small" color={palette.accentDeep} />
                  <Text style={styles.inlineText}>Searching...</Text>
                </View>
              )}
              {searchError && <Text style={styles.errorText}>{searchError}</Text>}
              {!!query.trim() && !searchLoading && searchResults.length === 0 && (
                <Text style={styles.emptyText}>No matching users.</Text>
              )}
              {searchResults.length > 0 && (
                <>
                  <View style={styles.table}>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableHeaderText, styles.rankCol]}>
                        Rank
                      </Text>
                      <Text style={[styles.tableHeaderText, styles.userCol]}>
                        Username
                      </Text>
                      <Text style={[styles.tableHeaderText, styles.ratingCol]}>
                        Rating
                      </Text>
                    </View>
                    {searchResults.map((entry) => (
                      <EntryRow key={`${entry.username}-search`} entry={entry} />
                    ))}
                  </View>
                  {resolvedSearchTotalPages > 1 && (
                    <Pagination
                      page={searchPageSafe}
                      totalPages={resolvedSearchTotalPages}
                      label={`Page ${searchPageSafe} of ${resolvedSearchTotalPages} | ${searchRangeLabel}`}
                      onPrev={() =>
                        setSearchPage((prev) => Math.max(1, prev - 1))
                      }
                      onNext={() =>
                        setSearchPage((prev) =>
                          Math.min(resolvedSearchTotalPages, prev + 1)
                        )
                      }
                    />
                  )}
                </>
              )}
            </BlurView>
          </Animated.View>

          <Animated.View style={[styles.section, boardStyle]}>
            <BlurView intensity={22} tint="light" style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Leaderboard</Text>
                <Text style={styles.sectionBadge}>All Users</Text>
              </View>
              <Text style={styles.sectionHint}>
                Showing {boardRangeLabel}. Rankings update automatically every few
                seconds.
              </Text>

              {leaderboardLoading && (
                <View style={styles.inlineRow}>
                  <ActivityIndicator size="small" color={palette.accentDeep} />
                  <Text style={styles.inlineText}>Loading leaderboard...</Text>
                </View>
              )}
              {leaderboardError && (
                <Text style={styles.errorText}>{leaderboardError}</Text>
              )}

              {!leaderboardLoading && leaderboard.length > 0 && (
                <>
                  <View style={styles.table}>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableHeaderText, styles.rankCol]}>
                        Rank
                      </Text>
                      <Text style={[styles.tableHeaderText, styles.userCol]}>
                        Username
                      </Text>
                      <Text style={[styles.tableHeaderText, styles.ratingCol]}>
                        Rating
                      </Text>
                    </View>
                    {leaderboard.map((entry) => (
                      <EntryRow key={`${entry.username}-board`} entry={entry} />
                    ))}
                  </View>
                  {resolvedBoardTotalPages > 1 && (
                    <Pagination
                      page={boardPageSafe}
                      totalPages={resolvedBoardTotalPages}
                      label={`Page ${boardPageSafe} of ${resolvedBoardTotalPages} | ${boardRangeLabel}`}
                      onPrev={() =>
                        setBoardPage((prev) => Math.max(1, prev - 1))
                      }
                      onNext={() =>
                        setBoardPage((prev) =>
                          Math.min(resolvedBoardTotalPages, prev + 1)
                        )
                      }
                    />
                  )}
                </>
              )}
            </BlurView>
          </Animated.View>
        </ScrollView>
        <StatusBar style="dark" />
      </LinearGradient>
    </SafeAreaView>
  );
}

const palette = {
  bgTop: "#FFF4E6",
  bgMid: "#FFE6CF",
  bgBottom: "#E7F3FF",
  ink: "#102A2A",
  inkMuted: "#3C5754",
  accent: "#F2A93B",
  accentDeep: "#D07F1C",
  card: "rgba(255, 255, 255, 0.82)",
  border: "rgba(16, 42, 42, 0.1)",
  mint: "#D7F3EF",
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.bgTop,
  },
  background: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.bgTop,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 96,
    paddingTop: 32,
    gap: 18,
  },
  headerCard: {
    padding: 20,
    borderRadius: 22,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 5,
  },
  title: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 30,
    color: palette.ink,
  },
  subtitle: {
    fontFamily: "SpaceGrotesk_400Regular",
    fontSize: 14,
    color: palette.inkMuted,
    marginTop: 6,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  metaPill: {
    flex: 1,
    backgroundColor: palette.mint,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  metaLabel: {
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 12,
    color: palette.inkMuted,
  },
  metaValue: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 18,
    color: palette.ink,
    marginTop: 2,
  },
  section: {
    borderRadius: 22,
  },
  card: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 20,
    color: palette.ink,
  },
  sectionBadge: {
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 12,
    color: palette.ink,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(242, 169, 59, 0.25)",
  },
  sectionHint: {
    fontFamily: "SpaceGrotesk_400Regular",
    fontSize: 12,
    color: palette.inkMuted,
    marginTop: 6,
    marginBottom: 12,
  },
  searchInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 16,
    color: palette.ink,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  inlineText: {
    fontFamily: "SpaceGrotesk_400Regular",
    fontSize: 12,
    color: palette.inkMuted,
  },
  errorText: {
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 12,
    color: "#C0392B",
    marginTop: 10,
  },
  emptyText: {
    fontFamily: "SpaceGrotesk_400Regular",
    fontSize: 12,
    color: palette.inkMuted,
    marginTop: 10,
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  tableHeaderText: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 12,
    color: palette.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  paginationButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  paginationButtonDisabled: {
    opacity: 0.4,
  },
  paginationButtonText: {
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 12,
    color: palette.ink,
  },
  paginationLabel: {
    flex: 1,
    textAlign: "center",
    fontFamily: "SpaceGrotesk_400Regular",
    fontSize: 12,
    color: palette.inkMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 42, 42, 0.05)",
  },
  rankPill: {
    width: 46,
    height: 30,
    borderRadius: 12,
    backgroundColor: "rgba(242, 169, 59, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  rankText: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 12,
    color: palette.accentDeep,
  },
  username: {
    flex: 1,
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 14,
    color: palette.ink,
  },
  rating: {
    width: 70,
    textAlign: "right",
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 14,
    color: palette.ink,
  },
  rankCol: {
    width: 60,
  },
  userCol: {
    flex: 1,
  },
  ratingCol: {
    width: 70,
    textAlign: "right",
  },
  orbOne: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(242, 169, 59, 0.25)",
    top: -30,
    right: -40,
  },
  orbTwo: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(30, 107, 109, 0.15)",
    bottom: 120,
    left: -60,
  },
  orbThree: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(16, 42, 42, 0.08)",
    bottom: -30,
    right: 40,
  },
});
