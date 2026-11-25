/**
 * Team — the office's job board. A post (photo + one line) is a job with a person and a
 * status; this list is what is waiting on whom. Replaces scrolling the WhatsApp group.
 *
 *   My jobs   open and given to me, oldest first (do the top one next)
 *   Open      everything still open, oldest first
 *   Sent      what I posted that is still open
 *   All       the whole feed, newest first
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';

import { FloatingNav } from '@/components/FloatingNav';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { JobCard } from '@/components/team/JobCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResponsive } from '@/hooks/useResponsive';
import { notificationService } from '@/services/NotificationService';
import { erpSession, Job, JobView, Person, team } from '@/services/teamApi';

const VIEWS: { view: JobView; label: string }[] = [
    { view: 'mine', label: 'My jobs' },
    { view: 'open', label: 'Open' },
    { view: 'sent', label: 'Sent' },
    { view: 'feed', label: 'All' },
];
const POLL_MS = 20000;
const SEEN_KEY = 'team_seen_mine';

export default function TeamScreen() {
    const router = useRouter();
    const theme = useColorScheme() ?? 'light';
    const colors = Colors[theme];
    const { vs, ms } = useResponsive();

    const [view, setView] = useState<JobView>('mine');
    const [jobs, setJobs] = useState<Job[]>([]);
    const [me, setMe] = useState<Person | null>(null);
    const [mineCount, setMineCount] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const viewRef = useRef(view);
    viewRef.current = view;

    const load = useCallback(async (which: JobView = viewRef.current) => {
        const [list, mine] = await Promise.all([
            team.jobs(which),
            which === 'mine' ? Promise.resolve(null) : team.jobs('mine'),
        ]);
        if (which !== viewRef.current) return; // the person switched tabs meanwhile
        if (!list.ok) {
            setError(list.error);
        } else {
            setError(null);
            setJobs(list.data.jobs);
            const myJobs = which === 'mine' ? list.data.jobs : mine && mine.ok ? mine.data.jobs : null;
            if (myJobs) {
                setMineCount(myJobs.length);
                await announceNew(myJobs);
            }
        }
        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => {
        team.people().then(r => { if (r.ok) setMe(r.data.me); });
    }, []);

    // Refresh while the screen is in front; stop when it is not.
    useFocusEffect(useCallback(() => {
        load();
        const timer = setInterval(() => load(), POLL_MS);
        return () => clearInterval(timer);
    }, [load]));

    const switchTo = (v: JobView) => {
        setView(v);
        setLoading(true);
        setJobs([]);
        load(v);
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScreenHeader
                title="Team Chat"
                subtitle={me?.name}
                onBack={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
                rightIcon="add"
                onRightPress={() => router.push('/team/new')}
            >
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
                    {VIEWS.map(v => {
                        const active = v.view === view;
                        const label = v.view === 'mine' && mineCount !== null ? `${v.label} (${mineCount})` : v.label;
                        return (
                            <TouchableOpacity
                                key={v.view}
                                onPress={() => switchTo(v.view)}
                                style={[styles.pill, {
                                    backgroundColor: active ? '#FFF' : 'rgba(255,255,255,0.16)',
                                    borderColor: active ? '#FFF' : 'rgba(255,255,255,0.3)',
                                }]}
                            >
                                <Text style={{ color: active ? colors.primary : '#FFF', fontWeight: '800', fontSize: ms(14) }}>{label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </ScreenHeader>

            {error ? (
                <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.danger }]}>
                    <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
                    <Text style={[styles.noticeText, { color: colors.text }]}>{error}</Text>
                    <TouchableOpacity onPress={() => { setLoading(true); load(); }}>
                        <Text style={{ color: colors.primary, fontWeight: '800' }}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : loading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
            ) : (
                <FlatList
                    data={jobs}
                    keyExtractor={j => j.id}
                    renderItem={({ item }) => (
                        <JobCard job={item} meId={me?.id} onPress={() => router.push({ pathname: '/team/[id]', params: { id: item.id } })} />
                    )}
                    contentContainerStyle={{ paddingTop: 16, paddingBottom: vs(140) }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
                    ListEmptyComponent={
                        <Text style={[styles.empty, { color: colors.textSecondary }]}>
                            {view === 'mine' ? 'Nothing waiting on you. 🎉' : view === 'sent' ? 'Nothing you posted is still open.' : 'No jobs yet.'}
                        </Text>
                    }
                />
            )}
            <FloatingNav />
        </View>
    );
}

/**
 * A local alert for each job newly given to me since the list was last read — covers the
 * app being open or in the background. What has been seen is kept per ERPNext session, so a
 * different person logging in on this phone is not alerted to someone else's backlog.
 */
async function announceNew(mine: Job[]): Promise<void> {
    try {
        const [raw, sid] = await Promise.all([SecureStore.getItemAsync(SEEN_KEY), erpSession()]);
        const ids = mine.map(j => j.id);
        const kept = parseSeen(raw);
        if (!kept || kept.sid !== sid) { // first look for this login: remember, do not announce the backlog
            await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify({ sid, ids }));
            return;
        }
        const seen = new Set<string>(kept.ids);
        for (const job of mine.filter(j => !seen.has(j.id))) {
            await notificationService.postLocalNotification(
                `${job.kind_label} — from ${job.author.name}`,
                job.body || job.customer_hint || 'A new job for you', { teamJobId: job.id });
        }
        await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify({ sid, ids: ids.slice(0, 200) }));
    } catch {
        // an alert that could not be shown is not a reason to break the list
    }
}

function parseSeen(raw: string | null): { sid: string | null; ids: string[] } | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw);
        return v && Array.isArray(v.ids) ? v : null;
    } catch {
        return null;
    }
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    pills: { gap: 8, paddingTop: 12 },
    pill: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1 },
    notice: { margin: 16, padding: 16, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    noticeText: { flex: 1, fontSize: 14, fontWeight: '600' },
    empty: { textAlign: 'center', marginTop: 48, fontSize: 15, fontWeight: '600' },
});
