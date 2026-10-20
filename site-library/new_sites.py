"""Additional concepts with retained visual assets and distinct art direction."""
import json
from pathlib import Path


def visual(name):
    return json.loads((Path(__file__).parent / 'assets' / (name + '.json')).read_text(encoding='utf-8'))


def register(site):
    site(id='cafe', name='Daybreak Coffee', cat='Neighborhood café', font='saira',
         pal=dict(bg='#F5EEDD', panel='#FFF9EE', fg='#292119', mut='#6D5B4C', line='#D8CBB7', deep='#B9361D', ondeep='#FFF1D5', acc='#9A2E19', onacc='#FFFFFF', accd='#FFAA82', onaccd='#301108'),
         layout='split', eyebrow='Coffee. Conversation. A slower morning.', headline='Good days start here.',
         lead='An espresso at the counter. Something warm from the oven. A corner to call yours.', cta='Plan a visit',
         hero='', hero_image=visual('cafe-hero'), show_gallery=False,
         svc_title='At the counter', service_hint='Choose a drink to try the enquiry form.',
         svcs=[('Espresso & long black','A short pause or a long morning.'), ('Flat white & latte','Espresso, silky milk, your favorite cup.'), ('Filter coffee','A different way to explore the roast.'), ('Tea & something cold','For the days that call for a change.'), ('From the oven','Ask what is baking when you arrive.'), ('Coffee for a gathering','Tell us about your group or event.')],
         sec2=('Stay a little',[('The coffee','Ask about the current roast at the counter.'),('The table','Bring a book, a friend, or just yourself.'),('The neighborhood','A familiar stop in your everyday rhythm.')],'steps'),
         gallery=[],
         form=dict(title='Meet us at Daybreak',jobl='What brings you in',extra=[('Your question','txt','Menu, accessibility or a group visit')],walk=None),
         hours=[(7,16),(7,16),(7,16),(7,16),(7,17),(8,17),(8,14)],area=['Sample neighborhood location'],phone='(555) 010-0195')
    site(id='florist', name='Petal & Stem', cat='Floral studio', font='playfair',
         pal=dict(bg='#F7F2E9',panel='#FFFCF5',fg='#34382A',mut='#63684F',line='#DADCCB',deep='#35412F',ondeep='#F7F2E9',acc='#6B4A55',onacc='#FFFFFF',accd='#E6ABBC',onaccd='#29131C'),
         layout='split',eyebrow='Flowers for the feeling.',headline='A little wild. Entirely yours.',
         lead='Thoughtful arrangements for everyday gestures, big celebrations and the moments words cannot quite hold.',cta='Tell us the occasion',
         hero='',hero_image=visual('florist-hero'),show_gallery=False,
         svc_title='Something worth sending',service_hint='Choose an occasion to begin your enquiry.',
         svcs=[('Everyday flowers','A gesture for someone, or something for yourself.'),('Wedding flowers','A conversation about your day, palette and setting.'),('Gatherings & events','Flowers that become part of the room.'),('A thoughtful tribute','Personal flowers for remembrance and care.')],
         sec2=('From a thought to a bouquet',[('The feeling','Tell us who it is for and what you have in mind.'),('The season','We discuss the flowers and colors available.'),('The handover','Confirm the details and collection arrangements together.')],'steps'),
         gallery=[],
         form=dict(title='What shall we make',jobl='Occasion',extra=[('Palette or feeling','txt','Soft and romantic, bright and playful…'),('Date','txt','When would you like the flowers?')],walk=None),
         hours=[(0,0),(10,17),(10,17),(10,17),(10,17),(9,14),(0,0)],area=['Sample studio location','Delivery area confirmed with the owner'],phone='(555) 010-0196')
    site(id='tattoo',name='Stillmark Studio',cat='Tattoo studio',font='bebas',
         pal=dict(bg='#161714',panel='#21221E',fg='#EAE3D0',mut='#B8B4A5',line='#414239',deep='#0C0D0B',ondeep='#EAE3D0',acc='#D5BB82',onacc='#1A190F',accd='#E3CF9D',onaccd='#1A190F'),
         layout='split',eyebrow='An independent tattoo studio concept',headline='Make it mean something.',
         lead='Blackwork, fine lines and ideas worth carrying. Bring a rough thought. Let the conversation shape the piece.',cta='Discuss a piece',
         hero='',hero_image=visual('tattoo-hero'),show_gallery=False,
         svc_title='Find your direction',service_hint='Choose a starting point for your consultation.',
         svcs=[('Blackwork','Contrast, texture and considered negative space.'),('Botanical','Organic shapes and detailed linework.'),('Personal symbols','Something with a story that belongs to you.'),('Develop an idea','A starting point, reference or conversation.')],
         sec2=('Before the first line',[('The conversation','Share the idea, placement and approximate size.'),('The design','Discuss references, approach and the right artist.'),('The appointment','The studio confirms suitability, timing and preparation.')],'steps'),
         gallery=[],
         form=dict(title='Tell us your idea',jobl='Starting point',extra=[('Placement & size','txt','Where, and approximately how large?'),('Design idea','txt','Describe the story or visual direction')],walk=None),
         hours=[(0,0),(11,18),(11,18),(11,18),(11,18),(11,17),(0,0)],area=['Sample studio location','Consultations by arrangement'],phone='(555) 010-0197')
