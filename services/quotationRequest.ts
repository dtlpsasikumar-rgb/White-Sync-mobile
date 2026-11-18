/**
 * quotationRequest.ts — creates a Draft Quotation in ERP from the phone (Quotation or Proforma).
 * The rate comes from ERP's Standard Selling price list, as ERP fills it.
 */

import * as SecureStore from 'expo-secure-store';
import { apiUrl } from '@/constants/config';
import { apiGet, apiPost } from '@/utils/api';

export type RequestType = 'quotation' | 'proforma';

export const REQUEST_BRANDS = ['HABASIT', 'PRECITEX', 'INSPIRON', 'SUPREME', 'STERLING', 'WHITENCO', 'RMP'];

/** ERP naming series per brand, as the ERP Quotation form offers them. */
const SERIES: Record<string, Record<RequestType, string>> = {
    HABASIT: { quotation: 'HAB/WC/2026-27/Q-', proforma: 'HAB/WC/2026-27/P-' },
    PRECITEX: { quotation: 'PRE/WC/2026-27/', proforma: 'PRE/WC/2026-27/-P' },
    INSPIRON: { quotation: 'INSP/WC/2026-27/', proforma: 'SAL-PRF-.YYYY.-' },
    SUPREME: { quotation: 'SUP/WC/LET/2026-2027/', proforma: 'SUP/WC/LET/2026-2027/P-' },
    STERLING: { quotation: 'SAL-QTN-.YYYY.-', proforma: 'SAL-PRF-.YYYY.-' },
    WHITENCO: { quotation: 'WC/2026-27/-', proforma: 'SAL-PRF-.YYYY.-' },
    RMP: { quotation: 'RMP/WC/2026-27/', proforma: 'SAL-PRF-.YYYY.-' },
};

export type RequestItem = { item_code: string; item_name: string; stock_uom: string };

const session = () => SecureStore.getItemAsync('session_cookies');

/** Items of one brand, matched on code or name. */
export async function searchItemsByBrand(brand: string, query: string): Promise<RequestItem[]> {
    const q = query.trim();
    const filters: any[] = [['brand', '=', brand], ['disabled', '=', 0], ['has_variants', '=', 0]];
    if (q) filters.push(['item_name', 'like', `%${q}%`]);
    const qs =
        `fields=${encodeURIComponent(JSON.stringify(['item_code', 'item_name', 'stock_uom']))}` +
        `&filters=${encodeURIComponent(JSON.stringify(filters))}` +
        `&limit_page_length=30`;
    const res = await apiGet(apiUrl(`/api/resource/Item?${qs}`), await session());
    if (!res.ok) return [];
    return ((res.data as any)?.data || []) as RequestItem[];
}

/** Frappe puts errors in _server_messages (a JSON-encoded list of JSON messages). Pull out readable text. */
function erpErrorText(data: any): string {
    try {
        const raw = data?._server_messages;
        if (raw) {
            const list: string[] = JSON.parse(raw);
            const texts = list.map(m => { try { return JSON.parse(m).message; } catch { return m; } });
            return texts.join(' ').replace(/<[^>]+>/g, '').slice(0, 300);
        }
        if (data?.exception) return String(data.exception).split('\n').pop()!.slice(0, 300);
    } catch { /* fall through */ }
    return '';
}

/** Creates the request as a Draft Quotation in ERP. Returns the ERP name, or throws with the reason. */
export async function createRequestDraft(p: {
    type: RequestType;
    brand: string;
    customerId: string;
    lines: { item: RequestItem; qty: number }[];
}): Promise<string> {
    const today = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const validTill = new Date(today);
    validTill.setDate(validTill.getDate() + 30);

    const body = {
        quotation_to: 'Customer',
        party_name: p.customerId,
        transaction_date: iso(today),
        valid_till: iso(validTill),
        order_type: 'Sales',
        company: 'White & Co.',
        currency: 'INR',
        selling_price_list: 'Standard Selling',
        naming_series: SERIES[p.brand][p.type],
        brand: p.brand,
        status: 'Draft',
        items: p.lines.map(l => ({ item_code: l.item.item_code, item_name: l.item.item_name, qty: l.qty, uom: l.item.stock_uom, brand: p.brand })),
    };
    const res = await apiPost(apiUrl('/api/resource/Quotation'), body, await session());
    const name = (res.data as any)?.data?.name;
    if (!res.ok || !name) {
        throw new Error(erpErrorText(res.data) || 'ERP did not accept the request.');
    }
    return name;
}
