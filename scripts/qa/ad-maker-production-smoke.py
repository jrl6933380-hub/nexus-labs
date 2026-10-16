# Public production QA; no credentials and no saves. Requires Playwright and browser OS dependencies.
# Run: python -m playwright install chromium --with-deps; python scripts/qa/ad-maker-production-smoke.py
import json,base64
from playwright.sync_api import sync_playwright
base='https://nexus-labs-sigma.vercel.app'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 for label,viewport in [('phone',{'width':390,'height':844}),('desktop',{'width':1440,'height':1000})]:
  page=browser.new_page(viewport=viewport,is_mobile=label=='phone',has_touch=label=='phone',device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base+'/ad-maker.html?t=0',wait_until='networkidle',timeout=30000)
  page.wait_for_function('!!window.adPlayer',timeout=15000)
  page.evaluate("""async()=>{const html=await(await fetch('/ad-designs/nexus-team-film.html')).text();window.adPlayer.setDesign({name:'QA team film',html});}""")
  page.wait_for_function('window.adPlayer.ready',timeout=15000)
  print('QA_READY',label)
  for ms,scene in [(1800,'hook'),(6500,'team'),(12500,'reveal'),(17000,'close')]:
   page.evaluate('(t)=>window.adPlayer.seek(t)',ms)
   page.wait_for_timeout(120)
   child=page.frames[-1]
   details=child.evaluate("""()=>{const shots=[...document.querySelectorAll('[data-shot]')];const active=shots.find(s=>!s.hidden),r=active.getBoundingClientRect(),h=active.querySelector('.headline').getBoundingClientRect(),support=active.querySelector('.support').getBoundingClientRect();return {scene:active.dataset.shot,viewport:[innerWidth,innerHeight],headline:[h.x,h.y,h.width,h.height],supportBottom:support.bottom,headlineInFrame:h.x>=0&&h.right<=innerWidth+1&&h.y>=0&&h.bottom<=innerHeight+1,scrollWidth:document.documentElement.scrollWidth};}""")
   assert details['scene']==scene,(label,details)
   assert details['headlineInFrame'],(label,details)
   print('FRAME',label,ms,json.dumps(details))
   if label=='phone' and scene in ['team','reveal']:
    raw=page.locator('#stage').screenshot(type='jpeg',quality=75)
    print('IMAGE',label+'-'+scene,base64.b64encode(raw).decode())
  page.evaluate('window.adPlayer.seek(6500)')
  page.wait_for_timeout(100);first=page.locator('#stage').screenshot()
  page.evaluate('window.adPlayer.seek(17500)');page.wait_for_timeout(100)
  page.evaluate('window.adPlayer.seek(6500)');page.wait_for_timeout(100)
  second=page.locator('#stage').screenshot()
  print('DETERMINISTIC_PIXELS',label,first==second)
  assert first==second,label+' pixels not deterministic'
  page.locator('#record').click()
  page.wait_for_timeout(3500)
  assert page.evaluate("document.body.classList.contains('recording')")
  assert page.evaluate('window.adPlayer.playing')
  page.keyboard.press('Escape')
  assert not page.evaluate("document.body.classList.contains('recording')")
  print('RECORD_ESCAPE',label,'pass','PAGE_ERRORS',json.dumps(errors))
  page.close()
 browser.close()
