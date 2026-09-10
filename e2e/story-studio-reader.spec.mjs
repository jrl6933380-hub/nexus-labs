import { test, expect } from '@playwright/test';

const comic = {
  title:'The Signal',
  logline:'A courier discovers the package is calling her by name.',
  genre:'Science fiction',
  visualStyle:'Cinematic graphic novel',
  palette:['#101525','#7b45d6','#58d7ff'],
  characters:[{name:'Mara',role:'Courier',appearance:'Cropped dark hair and red utility coat',continuity:'Silver wrist band'}],
  panels:Array.from({length:6},(_,index) => ({
    number:index + 1,
    title:`Beat ${index + 1}`,
    beat:`The mystery advances in scene ${index + 1}.`,
    shot:index % 2 ? 'Close-up' : 'Wide shot',
    setting:'Rainy elevated train platform',
    caption:index === 0 ? 'The last train was never empty.' : '',
    dialogue:[{speaker:index % 2 ? 'Package' : 'Mara',line:index % 2 ? 'I have been waiting for you.' : 'Who said that?',type:index === 1 ? 'thought' : 'speech',side:index % 2 ? 'right' : 'left',layout:index === 0 ? {x:56,y:8,width:24,source:'vision'} : null}],
    artDirection:'Violet rain light and a red coat.',
    image:{url:`/api/story-image?id=story-1&panel=${index}&v=777`,model:'test-image',generatedAt:777},
  })),
};

test('a mobile customer receives a clean Nex-finished comic and reader', async ({page}) => {
  await page.setViewportSize({width:393,height:852});
  await page.route('**/api/room-auth',route => route.fulfill({json:{username:'reader-test'}}));
  await page.route('**/api/room-usage',route => route.fulfill({json:{usage:{remaining:90}}}));
  await page.route('**/api/story-image**',route => {
    const panel = new URL(route.request().url()).searchParams.get('panel') || '0';
    return route.fulfill({
      contentType:'image/svg+xml',
      body:`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><defs><linearGradient id="g"><stop stop-color="#151c2a"/><stop offset="1" stop-color="#7546d7"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="450" cy="260" r="150" fill="#58d7ff" opacity=".32"/><text x="50%" y="52%" text-anchor="middle" fill="white" font-size="54">SCENE ${Number(panel)+1}</text></svg>`,
    });
  });
  await page.route('**/api/story-studio**',route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.searchParams.has('id')) return route.fulfill({json:{project:{id:'story-1',sourceTitle:'Chapter one',sourceText:'A'.repeat(180),comic}}});
    if (route.request().method() === 'GET') return route.fulfill({json:{projects:[{id:'story-1',comicTitle:comic.title,panelCount:6,updatedAt:777}]}});
    return route.fulfill({json:{project:{id:'story-1',sourceTitle:'Chapter one',sourceText:'A'.repeat(180),comic}}});
  });

  await page.goto('/story-studio.html');
  await page.getByRole('button',{name:/The Signal/}).click();
  await expect(page.locator('.comic-panel')).toHaveCount(6);
  const firstPanel = page.locator('.comic-panel').first();
  const firstBubble = firstPanel.locator('.comic-bubble');
  await expect(firstBubble).toContainText('Who said that?');
  await expect(firstBubble).toHaveAttribute('data-positioned','true');
  await expect(page.getByText('Save edits',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Export JSON',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Regenerate art',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Speech bubbles',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Art direction',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Delete comic'})).toBeVisible();

  await page.getByRole('button',{name:'Read full comic'}).first().click();
  await expect(page.locator('.comic-reader')).toBeVisible();
  await expect(page.locator('.reader-panel')).toHaveCount(6);
  await expect(page.locator('.reader-panel').first().locator('.comic-bubble')).toHaveCount(1);
  await expect(page.locator('.reader-page')).toContainText('END OF ISSUE');
  const readerColumns = await page.locator('.reader-page').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(readerColumns).toBe(1);
});
