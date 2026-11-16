// End-to-end journeys through the real game in a browser.
//
// Each test scripts the deck so the outcome is known in advance, then plays
// through the UI the way a player would. Test names start with the
// requirement they cover (see TESTING.md). Tests wrapped in test.fail() are
// known bugs: they describe the spec, currently fail, and will flag
// themselves the moment the bug is fixed.

import { test, expect } from '@playwright/test';
import { startGame, openingDeal, skipRedraw, handSummary, continueFromSummary } from './helpers.mjs';

// The opponent is always Risky Rick, who hits until 18.
const BOT = 'Risky Rick';

test.describe('Playing a hand', () => {
  test('US-1.5c: a dealt Natural Blackjack wins the hand immediately', async ({ page }) => {
    await startGame(page, {
      deal: openingDeal([['A', 'K'], ['2', '3'], ['4', '4']], [['10', '8'], ['10', '8'], ['10', '8']])
    });
    await skipRedraw(page);

    expect(await handSummary(page)).toContain('Blackjack! Immediate victory.');
  });

  test('GDD-Win: standing on a higher total wins the hand', async ({ page }) => {
    await startGame(page, {
      deal: openingDeal([['10', 'Q'], ['2', '3'], ['4', '4']], [['10', '9'], ['10', '8'], ['10', '8']])
    });
    await skipRedraw(page);
    await page.locator('#standButton').click();

    expect(await handSummary(page)).toContain(`You beat ${BOT} 20 to 19`);
  });

  test('GDD-Loss: hitting past 21 loses the hand', async ({ page }) => {
    await startGame(page, {
      deal: openingDeal([['10', '6'], ['2', '3'], ['4', '4']], [['10', '8'], ['10', '8'], ['10', '8']]),
      drawPile: ['K']
    });
    await skipRedraw(page);
    await page.locator('#hitButton').click();

    expect(await handSummary(page)).toContain('You busted!');
  });

  test('KOTH-Bot: the opponent hits until it reaches 18, then stands', async ({ page }) => {
    await startGame(page, {
      deal: openingDeal([['10', '7'], ['2', '3'], ['4', '4']], [['10', '2'], ['10', '8'], ['10', '8']]),
      drawPile: ['6'] // the bot's only draw: 12 + 6 = 18
    });
    await skipRedraw(page);
    await page.locator('#standButton').click();

    expect(await handSummary(page)).toContain(`${BOT} wins 18 to 17`);
  });

  test('GDD-Core loop: after Hand A, Hand B is played next', async ({ page }) => {
    await startGame(page, {
      deal: openingDeal([['10', 'Q'], ['9', '5'], ['4', '4']], [['10', '9'], ['10', '8'], ['10', '8']])
    });
    await skipRedraw(page);
    await page.locator('#standButton').click();
    await handSummary(page);
    await continueFromSummary(page, 'Next Hand');

    await expect(page.locator('#handIndicator')).toHaveText('Hand 2 of 3');
    await expect(page.locator('#playerTotal')).toHaveText('14'); // Hand B: 9 + 5
  });
});

test.describe('Known issues', () => {
  test('BUG-001: after a Doubled Hand A, Hand B is played next', async ({ page }) => {
    test.fail(true, 'BUG-001: a Doubled hand counts as two hands, so Hand B is skipped');

    await startGame(page, {
      deal: openingDeal([['5', '6'], ['9', '5'], ['4', '4']], [['10', '9'], ['10', '8'], ['10', '8']]),
      drawPile: ['8'] // the Double card: 11 + 8 = 19, a push with the bot's 19
    });
    await skipRedraw(page);
    await page.locator('#doubleButton').click();
    expect(await handSummary(page)).toContain('Push at 19');
    await continueFromSummary(page, 'Next Hand');

    await expect(page.locator('#playerTotal')).toHaveText('14', { timeout: 5_000 }); // Hand B, not Hand C (8)
  });

  test('BUG-002: losing a Doubled Hand A does not knock you out', async ({ page }) => {
    test.fail(true, 'BUG-002: a 0-2 deficit with two hands left is treated as unrecoverable');

    await startGame(page, {
      deal: openingDeal([['5', '6'], ['9', '5'], ['4', '4']], [['10', '9'], ['10', '8'], ['10', '8']]),
      drawPile: ['2'] // the Double card: 11 + 2 = 13, a loss to 19
    });
    await skipRedraw(page);
    await page.locator('#doubleButton').click();
    await handSummary(page);

    // Hands B and C are still worth a point each, so 2-2 and Sudden Death are still possible.
    await expect(page.locator('#startButton')).toHaveText('Next Hand', { timeout: 5_000 });
  });

  test('BUG-004 / US-1.5d: a tie after three hands deals a Sudden Death hand', async ({ page }) => {
    test.fail(true, 'BUG-004: only three hands are dealt, so the tie-breaker has no cards');

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await startGame(page, {
      // A: 20 v 19 win.  B: 17 v 19 loss.  C: 19 v 19 push.  Score 1-1.
      deal: openingDeal([['10', 'Q'], ['10', '7'], ['10', '9']], [['10', '9'], ['10', '9'], ['10', '9']])
    });
    await skipRedraw(page);

    for (const [expected, next] of [['You beat', 'Next Hand'], [`${BOT} wins`, 'Next Hand'], ['Push at 19', 'Tie-Breaker Hand']]) {
      await page.locator('#standButton').click();
      expect(await handSummary(page)).toContain(expected);
      await continueFromSummary(page, next);
    }

    // Sudden Death should deal a fresh two-card hand and let the player act.
    await expect(page.locator('#standButton')).toBeEnabled({ timeout: 5_000 });
    expect(errors).toEqual([]);
  });
});
