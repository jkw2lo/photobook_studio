// Milestone 1 through the real UI: new book → import 21 photos → auto draft → edit → reload → export.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURES = join(process.cwd(), 'fixtures', 'generated', 'trip');

test('import, draft, edit, reopen and export a book', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New book' }).first().click();
  await page.getByPlaceholder('e.g. Japan, Spring 2026').fill('E2E Trip');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.book-title')).toHaveText('E2E Trip');

  // Import
  await page.getByRole('button', { name: 'Choose a folder…' }).click();
  const path = page.getByLabel('Folder path');
  await path.fill(FIXTURES);
  await path.press('Enter');
  // Generous: the performance test may be importing 500 photos in parallel.
  await expect(page.getByText('21 photos directly in this folder')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Import this folder' }).click();
  await expect(page.getByText(/Imported 21 photos/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.library .tile')).toHaveCount(21);

  // Automatic draft
  // Auto draft fills the book straight away; its controls are in the side panel, next to the pages.
  await page.getByRole('button', { name: 'Generate first draft' }).click();
  await expect(page.locator('.auto-collage')).toContainText('24 pages');
  await expect(page.locator('.modal')).toHaveCount(0);
  // The whole book as the filmstrip shows it: photos and frame geometry on every spread.
  const spreadPhotos = () => page.locator('.navigator .el').evaluateAll((els) => els.map((e) => `${e.querySelector('img')?.getAttribute('src') ?? ''}@${(e as HTMLElement).style.left},${(e as HTMLElement).style.width}`).join('|'));
  const firstDraft = await spreadPhotos();
  await page.locator('.auto-collage').getByRole('button', { name: 'Another variation' }).click();
  await expect.poll(spreadPhotos).not.toBe(firstDraft);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(spreadPhotos).toBe(firstDraft);
  await expect(page.locator('.save')).toHaveText('Saved');

  // Manual edit: move the right-page photo on the first spread by dragging it.
  const overlay = page.locator('.overlay');
  const box = (await overlay.boundingBox())!;
  const from = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.35 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, from.y + 30, { steps: 8 });
  await page.mouse.up();
  const xField = page.locator('.field', { hasText: /^X/ }).locator('input');
  const movedX = await xField.inputValue();
  // Add a text box and edit it inline.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByRole('menuitem', { name: 'Body' }).click();
  await page.locator('.text-input').fill('Written in the E2E test');
  await page.locator('.text-input').blur();
  await expect(page.locator('.save')).toHaveText('Saved');

  // Reopen: the edits come back from disk.
  await page.reload();
  await expect(page.locator('.canvas .el-text', { hasText: 'Written in the E2E test' })).toBeVisible();
  await page.mouse.click(from.x - 40, from.y + 30);
  await expect(xField).toHaveValue(movedX);

  // Undo/redo round-trip on a fresh edit
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.getByRole('menuitem', { name: 'Body' }).click();
  const added = page.locator('.canvas .el-text', { hasText: 'Double-click to edit' });
  await expect(added).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(added).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(added).toHaveCount(1);

  // Export and verify
  await page.getByRole('button', { name: 'Export PDF' }).first().click();
  await page.locator('.modal').getByRole('button', { name: 'Export PDFs' }).click();
  await expect(page.locator('.export-result').first()).toContainText('Interior · Verified', { timeout: 60_000 });
  await expect(page.locator('.export-result').first()).toContainText('24 of 24 pages');
  await expect(page.locator('.export-result').nth(1)).toContainText('Cover · Verified');
});

test('make a collage poster: import, auto collage, switch style, export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New book/ }).first().click();
  await page.getByRole('button', { name: 'Poster / collage' }).click();
  await page.getByPlaceholder('e.g. Summer 2026').fill('E2E Poster');
  await page.getByRole('button', { name: 'Create poster' }).click();
  await expect(page.locator('.book-title')).toHaveText('E2E Poster');

  await page.getByRole('button', { name: 'Choose a folder…' }).click();
  const path = page.getByLabel('Folder path');
  await path.fill(FIXTURES);
  await path.press('Enter');
  await page.getByRole('button', { name: 'Import this folder' }).click();
  await expect(page.getByText(/Imported 21 photos|already in library/)).toBeVisible({ timeout: 60_000 });

  // Auto collage fills the sheet immediately and its controls sit in the side panel, beside the result.
  await page.getByRole('button', { name: 'Generate collage' }).click();
  const frames = page.locator('.canvas .el-image');
  await expect.poll(() => frames.count()).toBeGreaterThan(10);
  await expect(page.locator('.modal')).toHaveCount(0);
  // Order on the sheet (a shuffle changes the selection and/or the arrangement).
  const photoIds = () => frames.evaluateAll((els) => els.map((e) => e.querySelector('img')?.getAttribute('src') ?? '').join('|'));
  const before = await photoIds();
  await page.locator('.auto-collage').getByRole('button', { name: 'Shuffle' }).click();
  await expect.poll(photoIds).not.toBe(before);
  await expect(page.locator('.auto-collage')).toContainText('placed from');

  // Library preview: clicking a photo shows it with its details.
  await page.locator('.library .tile').first().click();
  await expect(page.locator('.preview-pane img')).toBeVisible();
  await expect(page.locator('.preview-pane .preview-meta')).toContainText('MP');

  // Text can be added to a poster, and survives re-arranging.
  await page.locator('.inspector').getByRole('button', { name: 'Add text' }).click();
  await page.getByRole('menuitem', { name: 'Quote' }).click();
  await expect(page.locator('.canvas .el-text')).toHaveCount(1);
  // Quick styles restyle it in one click (here: a band of colour behind the text).
  await page.locator('.inspector .quick-style', { hasText: 'Label band' }).click();
  await expect.poll(() => page.locator('.canvas .el-text').evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/rgba\(.*0\.85\)/);
  await page.keyboard.press('Escape');
  // "On sheet" arranges only the photos already there.
  await page.locator('.auto-collage').getByRole('radio', { name: 'On sheet' }).click();
  await page.locator('.auto-collage').getByRole('button', { name: 'Arrange' }).click();
  await expect(page.locator('.canvas .el-text')).toHaveCount(1);

  // Crop mode shows the floating crop toolbar; Enter finishes.
  const firstFrame = page.locator('.canvas .el-image').first();
  const fb = (await firstFrame.boundingBox())!;
  await page.mouse.dblclick(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await expect(page.locator('.crop-toolbar')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.crop-toolbar')).toHaveCount(0);
  await page.keyboard.press('Escape'); // deselect: back to the Poster panel

  // Right-click a photo to pin it: shuffling leaves it exactly where it is.
  const pinTarget = page.locator('.canvas .el-image').nth(2);
  const pb = (await pinTarget.boundingBox())!;
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2, { button: 'right' });
  await page.locator('.ctx-menu').getByRole('menuitemcheckbox', { name: /Pin in place/ }).click();
  await expect(page.locator('.pin-badge')).toHaveCount(1);
  await page.keyboard.press('Escape');
  const pinnedAt = await page.locator('.pin-badge-frame').boundingBox();
  const beforeShuffle = await photoIds();
  await page.locator('.auto-collage').getByRole('button', { name: 'Shuffle' }).click();
  await expect.poll(photoIds).not.toBe(beforeShuffle);
  expect(await page.locator('.pin-badge-frame').boundingBox()).toEqual(pinnedAt);

  // Re-flow as a pinboard from the side panel: same photos, tilted prints.
  await page.locator('.inspector .collage-style', { hasText: 'Pinboard' }).click();
  await expect.poll(async () => frames.evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.transform.includes('rotate')).length)).toBeGreaterThan(5);
  await expect(page.locator('.save')).toHaveText('Saved');

  // A template restyles the sheet: round photos, its own type and stars; then an icon from the palette.
  await page.locator('.template-card', { hasText: 'Night circles' }).click();
  await expect.poll(() => page.locator('.canvas .el-image').first().evaluate((e) => (e as HTMLElement).style.clipPath)).toContain('path(');
  await expect(page.locator('.canvas .el-shape')).toHaveCount(3);
  await page.locator('.palette .seg button', { hasText: 'Icons' }).click();
  await page.locator('.palette [aria-label="Add Heart"]').click();
  await expect(page.locator('.canvas .el-shape svg path')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(page.locator('.save')).toHaveText('Saved');

  await page.getByRole('button', { name: 'Export PDF' }).first().click();
  await page.locator('.modal').getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.locator('.export-result').first()).toContainText('Poster · Verified', { timeout: 60_000 });
  await expect(page.locator('.export-result').first()).toContainText('1 of 1 page');
});
