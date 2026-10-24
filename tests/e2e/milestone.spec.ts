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
  await expect(page.getByText('21 photos directly in this folder')).toBeVisible();
  await page.getByRole('button', { name: 'Import this folder' }).click();
  await expect(page.getByText(/Imported 21 photos/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.library .tile')).toHaveCount(21);

  // Automatic draft
  await page.getByRole('button', { name: 'Generate first draft' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('.report')).toContainText('24 pages');
  await page.getByRole('button', { name: 'Done' }).click();
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
