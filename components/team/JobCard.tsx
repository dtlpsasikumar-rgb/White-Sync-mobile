import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { age, Job, KIND_COLORS, KIND_ICONS } from '@/services/teamApi';

/** One job in a Team list: what is asked, by whom, for whom, and how long it has waited. */
export function JobCard({ job, meId, onPress }: { job: Job; meId?: string; onPress: () => void }) {
    const theme = useColorScheme() ?? 'light';
    const colors = Colors[theme];
    const isDark = theme === 'dark';
    const tint = KIND_COLORS[job.kind];
    const open = job.status === 'open';
    const forMe = job.assignee?.id === meId;
    const late = open && job.age_minutes >= 24 * 60;
    const who = job.assignee ? `${job.author.name} → ${job.assignee.name}` : `${job.author.name} → (nobody named)`;
    const customer = job.customer_name || job.customer_hint;

    return (
        <TouchableOpacity
            activeOpacity={0.8}
            onPress={onPress}
            style={[styles.card, {
                backgroundColor: colors.surface,
                borderColor: forMe && open ? tint : colors.border,
                opacity: job.status === 'cancelled' ? 0.55 : 1,
            }]}
        >
            <View style={[styles.icon, { backgroundColor: tint + (isDark ? '33' : '1A') }]}>
                <Ionicons name={KIND_ICONS[job.kind] as any} size={22} color={tint} />
            </View>
            <View style={styles.main}>
                <View style={styles.row}>
                    <Text style={[styles.kind, { color: tint }]} numberOfLines={1}>
                        {job.kind_label}{job.kind_suggested ? ' ?' : ''}
                    </Text>
                    <Text style={[styles.age, { color: late ? colors.danger : colors.textSecondary }]}>
                        {open ? age(job.age_minutes) : job.status === 'done' ? 'Done' : 'Cancelled'}
                    </Text>
                </View>
                <Text style={[styles.who, { color: colors.textSecondary }]} numberOfLines={1}>{who}</Text>
                {!!job.body && (
                    <Text style={[styles.body, { color: colors.text }]} numberOfLines={2}>{job.body}</Text>
                )}
                <View style={styles.chips}>
                    {!!customer && <Chip text={customer} colors={colors} />}
                    {!!job.principal && <Chip text={job.principal} colors={colors} />}
                    {!!job.attachment && <Chip icon="image-outline" text={job.attachment.ref || 'Photo'} colors={colors} />}
                    {!!job.erpnext_name && <Chip icon="document-attach-outline" text={job.erpnext_name} colors={colors} />}
                    {job.replies > 0 && <Chip icon="chatbubble-outline" text={String(job.replies)} colors={colors} />}
                    {job.status === 'done' && <Ionicons name="checkmark-circle" size={18} color={colors.success} />}
                </View>
            </View>
        </TouchableOpacity>
    );
}

function Chip({ text, icon, colors }: { text: string; icon?: string; colors: typeof Colors.light }) {
    return (
        <View style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
            {!!icon && <Ionicons name={icon as any} size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />}
            <Text style={[styles.chipText, { color: colors.textSecondary }]} numberOfLines={1}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row', borderRadius: 18, padding: 14, marginHorizontal: 16, marginBottom: 12,
        borderWidth: 1.5,
    },
    icon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    main: { flex: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kind: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
    age: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
    who: { fontSize: 12, fontWeight: '600', marginTop: 2 },
    body: { fontSize: 14, marginTop: 6, lineHeight: 19 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 200 },
    chipText: { fontSize: 11, fontWeight: '700' },
});
