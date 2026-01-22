import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SignalStrength } from '@/lib/politician/types';
import type { WatchlistSource } from '@/lib/types';

/**
 * Webhook endpoint for Telegram politician trading signals → Watchlist integration
 *
 * POST /api/watchlist/telegram-signal
 *
 * Body: {
 *   api_key: string,           // API key for authentication
 *   ticker: string,            // Stock ticker symbol
 *   politician_name?: string,  // Name of the politician
 *   amount_range?: string,     // Transaction amount range (e.g., "$500K-$1M")
 *   signal_date: string,       // ISO date string
 * }
 *
 * Only processes STRONG and MODERATE signals (filters out WEAK $1K-$15K)
 */

interface TelegramSignalPayload {
  api_key: string;
  ticker: string;
  politician_name?: string;
  amount_range?: string;
  signal_date: string;
}

interface TelegramSignalResponse {
  success: boolean;
  watchlist_id?: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * Determine signal strength based on amount range
 * Same logic as politician/signals/route.ts lines 61-68
 */
function determineStrength(amountRange?: string): SignalStrength {
  if (!amountRange) return 'MODERATE';

  if (
    amountRange.includes('$500K') ||
    amountRange.includes('$1M') ||
    amountRange.includes('$5M')
  ) {
    return 'STRONG';
  }

  if (amountRange.includes('$1K-$15K')) {
    return 'WEAK';
  }

  return 'MODERATE';
}

/**
 * Build notes string for watchlist item
 */
function buildNotes(
  politicianName: string | undefined,
  amountRange: string | undefined,
  strength: SignalStrength,
  signalDate: string
): string {
  const parts = ['[Politician Trading]'];

  if (politicianName) {
    parts.push(`Politician: ${politicianName}`);
  }

  if (amountRange) {
    parts.push(`Amount: ${amountRange}`);
  }

  parts.push(`Strength: ${strength}`);
  parts.push(`Signal Date: ${signalDate}`);

  return parts.join(' | ');
}

export async function POST(request: Request): Promise<NextResponse<TelegramSignalResponse>> {
  try {
    const body: TelegramSignalPayload = await request.json();

    // Validate required fields
    if (!body.api_key) {
      return NextResponse.json({ success: false, error: 'Missing api_key' }, { status: 400 });
    }
    if (!body.ticker) {
      return NextResponse.json({ success: false, error: 'Missing ticker' }, { status: 400 });
    }
    if (!body.signal_date) {
      return NextResponse.json({ success: false, error: 'Missing signal_date' }, { status: 400 });
    }

    // Validate API key
    const validApiKey = process.env.WATCHLIST_TELEGRAM_API_KEY;
    if (!validApiKey || body.api_key !== validApiKey) {
      return NextResponse.json({ success: false, error: 'Invalid api_key' }, { status: 401 });
    }

    // Get target user ID
    const userId = process.env.WATCHLIST_DEFAULT_USER_ID;
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error: WATCHLIST_DEFAULT_USER_ID not set' },
        { status: 500 }
      );
    }

    // Determine signal strength
    const strength = determineStrength(body.amount_range);

    // Filter out WEAK signals ($1K-$15K)
    if (strength === 'WEAK') {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `Signal strength is WEAK (amount: ${body.amount_range || 'unknown'}). Only STRONG and MODERATE signals are added to watchlist.`,
      });
    }

    const supabase = createAdminClient();
    const ticker = body.ticker.toUpperCase();
    const source: WatchlistSource = 'politician_trading';

    // Check for existing entry (dedupe by ticker for this user)
    const { data: existing } = await supabase
      .from('watchlists')
      .select('id, notes, date_added')
      .eq('user_id', userId)
      .eq('ticker', ticker)
      .single();

    if (existing) {
      // Ticker already in watchlist - update notes to include latest signal info
      const newNotes = buildNotes(body.politician_name, body.amount_range, strength, body.signal_date);
      const combinedNotes = existing.notes
        ? `${existing.notes}\n---\n${newNotes}`
        : newNotes;

      await supabase
        .from('watchlists')
        .update({ notes: combinedNotes })
        .eq('id', existing.id);

      return NextResponse.json({
        success: true,
        watchlist_id: existing.id,
        skipped: false,
        reason: `Ticker ${ticker} already in watchlist. Updated notes with new signal info.`,
      });
    }

    // Build notes for new entry
    const notes = buildNotes(body.politician_name, body.amount_range, strength, body.signal_date);

    // Insert new watchlist item
    const { data, error } = await supabase
      .from('watchlists')
      .insert({
        user_id: userId,
        ticker,
        notes,
        source,
      })
      .select('id')
      .single();

    if (error) {
      // Handle duplicate constraint (shouldn't happen due to check above, but just in case)
      if (error.code === '23505') {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: `Ticker ${ticker} already exists in watchlist (concurrent insert)`,
        });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      watchlist_id: data.id,
    });
  } catch (error) {
    console.error('Error in telegram-signal webhook:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check webhook health
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/watchlist/telegram-signal',
    method: 'POST',
    description: 'Add politician trading signals to watchlist (STRONG + MODERATE only)',
    requiredFields: ['api_key', 'ticker', 'signal_date'],
    optionalFields: ['politician_name', 'amount_range'],
    signalFiltering: {
      STRONG: '$500K+, $1M, $5M - Added to watchlist',
      MODERATE: 'Default/Other amounts - Added to watchlist',
      WEAK: '$1K-$15K - Filtered out (not added)',
    },
  });
}
