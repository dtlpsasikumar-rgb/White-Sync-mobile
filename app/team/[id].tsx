/**
 * One job: what was asked, the photo, the ERPNext step for its type, and the thread.
 *
 * The ERPNext step depends on the type (see SmartOps app/web/team_erpnext.py):
 *   pro-forma / quotation  make a DRAFT Quotation (closes itself when approved in ERPNext)
 *   place order            type the principal's order number (closes the job)
 *   dispatch               transporter + LR number (closes the job)
 *   payment                find the Tally receipt and confirm it (closes the job)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { pickAttachment } from '@/components/team/Attach';
import { PickerSheet } from '@/components/team/PickerSheet';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    age, Attachment, JobDetail, JobKind, KIND_COLORS, Payments, People, PickedFile, shortTime, team,
} from '@/services/teamApi';

const POLL_MS = 15000;

export default function JobScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const theme = useColorScheme() ?? 'light';
    const colors = Colors[theme];

    const [detail, setDetail] = useState<JobDetail | null>(null);
    const [people, setPeople] = useState<People | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reply, setReply] = useState('');
    const [replyFile, setReplyFile] = useState<PickedFile | null>(null);
    const [sheet, setSheet] = useState<'kind' | 'assignee' | null>(null);
    const [reference, setReference] = useState('');
    const [transporter, setTransporter] = useState('');
    const [payments, setPayments] = useState<Payments | null>(null);

    const load = useCallback(async () => {
        const r = await team.job(id);
        if (r.ok) { setDetail(r.data); setError(null); } else setError(r.error);
    }, [id]);

    useEffect(() => { team.people().then(r => { if (r.ok) setPeople(r.data); }); }, []);
    useFocusEffect(useCallback(() => {
        load();
        const t = setInterval(load, POLL_MS);
        return () => clearInterval(t);
    }, [load]));
    useEffect(() => { if (detail?.job.transporter && !transporter) setTransporter(detail.job.transporter); }, [detail, transporter]);

    /** Run one change; show what SmartOps said if it refused. */
    const act = async (fn: () => Promise<{ ok: true; data: JobDetail } | { ok: false; error: string }>) => {
        setBusy(true);
        const r = await fn();
        setBusy(false);
        if (r.ok) setDetail(r.data); else Alert.alert('Team', r.error);
        return r.ok;
    };

    if (!detail) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                {error ? <Text style={{ color: colors.danger, fontWeight: '700', padding: 24, textAlign: 'center' }}>{error}</Text>
                    : <ActivityIndicator color={colors.primary} />}
            </View>
        );
    }

    const { job, thread } = detail;
    const me = people?.me.id;
    const open = job.status === 'open';
    const tint = KIND_COLORS[job.kind];
    const mayAct = me === job.author.id || me === job.assignee?.id;

    const sendReply = async () => {
        if (!reply.trim() && !replyFile) return;
        const ok = await act(() => team.reply(job.id, reply.trim(), replyFile));
        if (ok) { setReply(''); setReplyFile(null); }
    };

    const findPayments = async () => {
        setBusy(true);
        const r = await team.payments(job.id);
        setBusy(false);
        if (r.ok) setPayments(r.data); else Alert.alert('Payment', r.error);
    };

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScreenHeader
                title={job.kind_label}
                subtitle={job.assignee ? `${job.author.name} → ${job.assignee.name}` : job.author.name}
                onBack={() => router.back()}
                rightIcon="ellipsis-horizontal"
                onRightPress={() => Alert.alert('Job', undefined, [
                        open ? { text: 'Mark done', onPress: () => act(() => team.done(job.id)) }
                            : { text: 'Reopen', onPress: () => act(() => team.reopen(job.id)) },
                        ...(open && me === job.author.id ? [{ text: 'Cancel job', style: 'destructive' as const, onPress: () => act(() => team.cancel(job.id)) }] : []),
                        { text: 'Close', style: 'cancel' as const },
                    ])}
            />

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
                {/* What is asked, of whom */}
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.rowBetween}>
                        <TouchableOpacity onPress={() => setSheet('kind')} style={[styles.kindChip, { backgroundColor: tint }]}>
                            <Text style={styles.kindText}>{job.kind_label}{job.kind_suggested ? ' ?' : ''}</Text>
                            <Ionicons name="chevron-down" size={14} color="#FFF" />
                        </TouchableOpacity>
                        <Text style={{ color: open ? colors.textSecondary : colors.success, fontWeight: '800' }}>
                            {open ? `waiting ${age(job.age_minutes)}` : job.status === 'done' ? `✓ Done${job.done_by ? ` by ${job.done_by.name}` : ''}` : 'Cancelled'}
                        </Text>
                    </View>
                    {job.kind_suggested && (
                        <Text style={[styles.note, { color: colors.warning }]}>SmartOps guessed this: {job.kind_why}. Tap the type to change it.</Text>
                    )}
                    <TouchableOpacity onPress={() => setSheet('assignee')} style={styles.assignee}>
                        <Ionicons name="person-circle-outline" size={22} color={colors.textSecondary} />
                        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
                            {job.author.name} → {job.assignee ? job.assignee.name : 'choose who it is for'}
                        </Text>
                        <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
                    </TouchableOpacity>
                    {!!job.body && <Text style={[styles.body, { color: colors.text }]}>{job.body}</Text>}
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{shortTime(job.created_at)}</Text>
                    {!!job.attachment && <AttachmentView a={job.attachment} colors={colors} />}
                </View>

                {/* The ERPNext step for this type */}
                {job.action !== 'none' && (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: tint }]}>
                        <Text style={[styles.section, { color: tint }]}>ERPNext</Text>

                        {job.action === 'quotation' && (job.erpnext_name && !job.erpnext_missing ? (
                            <View style={{ gap: 6 }}>
                                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{job.erpnext_name}</Text>
                                <Text style={{ color: colors.textSecondary }}>
                                    {open ? 'Draft made — send it for approval in ERPNext. This job closes when it is approved.' : 'Approved in ERPNext.'}
                                </Text>
                                <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.primary }]}
                                    onPress={() => router.push({ pathname: '/quotations/[id]', params: { id: job.erpnext_name! } })}>
                                    <Text style={{ color: colors.primary, fontWeight: '800' }}>Open the Quotation</Text>
                                </TouchableOpacity>
                            </View>
                        ) : open && mayAct ? (
                            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: tint }]}
                                onPress={() => router.push({ pathname: '/team/quotation', params: { id: job.id } })}>
                                <Ionicons name="document-text-outline" size={20} color="#FFF" />
                                <Text style={styles.primaryText}>Make draft {job.kind === 'proforma' ? 'pro-forma' : 'quotation'}</Text>
                            </TouchableOpacity>
                        ) : <Text style={{ color: colors.textSecondary }}>No Quotation yet.</Text>)}

                        {(job.action === 'order_ref' || job.action === 'dispatch') && (job.reference ? (
                            <Text style={{ color: colors.text, fontWeight: '700' }}>
                                {job.action === 'order_ref' ? `Order no. ${job.reference}` : `${job.transporter || 'Transport'} — LR ${job.reference}`}
                            </Text>
                        ) : open && mayAct ? (
                            <View style={{ gap: 10 }}>
                                {job.action === 'dispatch' && (
                                    <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                                        placeholder="Transporter" placeholderTextColor={colors.placeholder}
                                        value={transporter} onChangeText={setTransporter} />
                                )}
                                <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                                    placeholder={job.action === 'order_ref' ? `${job.principal || 'Principal'} order no.` : 'LR no.'}
                                    placeholderTextColor={colors.placeholder} value={reference} onChangeText={setReference} />
                                <TouchableOpacity disabled={busy || !reference.trim()}
                                    style={[styles.primaryBtn, { backgroundColor: tint, opacity: busy || !reference.trim() ? 0.5 : 1 }]}
                                    onPress={() => act(() => job.action === 'order_ref'
                                        ? team.orderRef(job.id, reference.trim())
                                        : team.dispatch(job.id, reference.trim(), transporter.trim()))}>
                                    <Text style={styles.primaryText}>Save and close the job</Text>
                                </TouchableOpacity>
                            </View>
                        ) : <Text style={{ color: colors.textSecondary }}>No number yet.</Text>)}

                        {job.action === 'payment' && (job.erpnext_name ? (
                            <Text style={{ color: colors.text, fontWeight: '700' }}>Matched to Tally receipt {job.erpnext_name}</Text>
                        ) : (
                            <View style={{ gap: 10 }}>
                                <TouchableOpacity disabled={busy} style={[styles.secondaryBtn, { borderColor: tint }]} onPress={findPayments}>
                                    <Text style={{ color: tint, fontWeight: '800' }}>Find it in Tally</Text>
                                </TouchableOpacity>
                                {payments && (
                                    <View style={{ gap: 8 }}>
                                        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                                            {payments.facts.utr ? `UTR ${payments.facts.utr}` : 'No UTR'} · {payments.facts.amount ? `₹${payments.facts.amount.toLocaleString('en-IN')}` : 'no amount'}
                                        </Text>
                                        {!!payments.note && <Text style={{ color: colors.warning, fontWeight: '600' }}>{payments.note}</Text>}
                                        {payments.candidates.map(c => (
                                            <View key={c.name} style={[styles.receipt, { borderColor: colors.border }]}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={{ color: colors.text, fontWeight: '800' }}>₹{c.amount.toLocaleString('en-IN')} · {c.customer}</Text>
                                                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Voucher {c.voucher_no} · {c.date}{c.sales_invoice ? ` · ${c.sales_invoice}` : ''}</Text>
                                                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{c.why}</Text>
                                                </View>
                                                {open && (
                                                    <TouchableOpacity disabled={busy} style={[styles.smallBtn, { backgroundColor: tint }]}
                                                        onPress={() => act(() => team.confirmPayment(job.id, c.name))}>
                                                        <Text style={styles.primaryText}>Confirm</Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                )}

                {/* The thread */}
                {thread.map(t => {
                    const mine = t.author?.id === me;
                    if (!t.author) {
                        return (
                            <View key={t.id} style={[styles.system, { backgroundColor: colors.surfaceSecondary }]}>
                                <Ionicons name="sparkles-outline" size={14} color={colors.textSecondary} />
                                <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>{t.body}</Text>
                            </View>
                        );
                    }
                    return (
                        <View key={t.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, {
                            backgroundColor: mine ? colors.primary : colors.surface, borderColor: colors.border,
                        }]}>
                            {!mine && <Text style={{ color: tint, fontWeight: '800', fontSize: 12 }}>{t.author.name}</Text>}
                            {!!t.body && <Text style={{ color: mine ? '#FFF' : colors.text, fontSize: 15 }}>{t.body}</Text>}
                            {!!t.attachment && <AttachmentView a={t.attachment} colors={colors} small />}
                            <Text style={{ color: mine ? 'rgba(255,255,255,0.8)' : colors.textSecondary, fontSize: 11, alignSelf: 'flex-end' }}>
                                {t.closed_job ? '✓ closed the job · ' : ''}{shortTime(t.created_at)}
                            </Text>
                        </View>
                    );
                })}
            </ScrollView>

            {/* Reply bar */}
            <View style={[styles.replyBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TouchableOpacity onPress={() => pickAttachment(setReplyFile)}>
                    <Ionicons name={replyFile ? 'image' : 'attach'} size={26} color={replyFile ? colors.success : colors.textSecondary} />
                </TouchableOpacity>
                <TextInput
                    style={[styles.replyInput, { color: colors.text, backgroundColor: colors.surfaceSecondary }]}
                    placeholder={open && me === job.assignee?.id ? 'Reply — "Order placed" closes the job' : 'Reply'}
                    placeholderTextColor={colors.placeholder} value={reply} onChangeText={setReply} multiline
                />
                <TouchableOpacity disabled={busy} onPress={sendReply} style={[styles.sendBtn, { backgroundColor: colors.primary }]}>
                    {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="send" size={18} color="#FFF" />}
                </TouchableOpacity>
            </View>

            <PickerSheet
                visible={sheet === 'kind'} title="What is asked" selected={job.kind}
                options={(people?.kinds ?? []).map(k => ({ value: k.kind, label: k.label }))}
                onPick={v => act(() => team.correct(job.id, { kind: v as JobKind }))}
                onClose={() => setSheet(null)}
            />
            <PickerSheet
                visible={sheet === 'assignee'} title="Who it is for" selected={job.assignee?.id}
                options={(people?.people ?? []).map(p => ({ value: p.id, label: p.name }))}
                onPick={v => act(() => team.correct(job.id, { assignee_id: v }))}
                onClose={() => setSheet(null)}
            />
        </KeyboardAvoidingView>
    );
}

/** The photo (or PDF) with what SmartOps read from it. */
function AttachmentView({ a, colors, small }: { a: Attachment; colors: typeof Colors.light; small?: boolean }) {
    const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
    useEffect(() => { team.fileSource(a).then(setSource); }, [a]);
    const isPdf = (a.mime || '').includes('pdf');
    const read = [a.kind && a.kind !== 'unknown' ? a.kind.replace(/_/g, ' ') : null, a.ref, a.party].filter(Boolean).join(' · ');
    return (
        <View style={{ gap: 6, marginTop: 6 }}>
            {isPdf || !source ? (
                <View style={[styles.pdf, { backgroundColor: colors.surfaceSecondary, height: small ? 56 : 80 }]}>
                    <Ionicons name={isPdf ? 'document-text' : 'image-outline'} size={28} color={colors.textSecondary} />
                    <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{a.filename || 'Attachment'}</Text>
                </View>
            ) : (
                <Image source={source} style={{ width: '100%', height: small ? 160 : 260, borderRadius: 14 }} contentFit="contain" />
            )}
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {a.status === 'received' || !a.status ? 'SmartOps is reading it…' : read ? `Read as: ${read}` : 'Could not read much from it.'}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    card: { borderRadius: 18, borderWidth: 1.5, padding: 14, gap: 8 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kindChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
    kindText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
    note: { fontSize: 12, fontWeight: '600' },
    assignee: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    body: { fontSize: 16, lineHeight: 22 },
    section: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
    primaryText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
    secondaryBtn: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    smallBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
    receipt: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
    system: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, padding: 10, alignSelf: 'center', maxWidth: '92%' },
    bubble: { maxWidth: '85%', borderRadius: 16, padding: 10, gap: 4, borderWidth: 1 },
    bubbleMine: { alignSelf: 'flex-end', borderBottomRightRadius: 4, borderWidth: 0 },
    bubbleTheirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
    pdf: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12 },
    replyBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 28, borderTopWidth: 1 },
    replyInput: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
    sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
});
