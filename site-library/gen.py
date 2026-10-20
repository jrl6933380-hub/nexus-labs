import json, html, os
E=html.escape
DARK=dict(bg="#121416",panel="#1B1E21",fg="#EEEBE4",mut="#9DA5AB",line="#2B3035",deep="#0B0C0D",ondeep="#EEEBE4")
FONTS={
 'saira':("Saira Condensed:wght@600;800","IBM Plex Sans:wght@400;500;600","'Saira Condensed','Arial Narrow',Impact,sans-serif","'IBM Plex Sans','Segoe UI',system-ui,sans-serif"),
 'fraunces':("Fraunces:opsz,wght@9..144,500;9..144,700","Karla:wght@400;500;700","'Fraunces',Georgia,serif","'Karla','Segoe UI',system-ui,sans-serif"),
 'bebas':("Bebas Neue","Work Sans:wght@400;500;600","'Bebas Neue',Impact,sans-serif","'Work Sans','Segoe UI',system-ui,sans-serif"),
 'dmserif':("DM Serif Display","DM Sans:wght@400;500;700","'DM Serif Display',Georgia,serif","'DM Sans','Segoe UI',system-ui,sans-serif"),
 'syne':("Syne:wght@600;800","Manrope:wght@400;500;700","'Syne','Segoe UI',sans-serif","'Manrope','Segoe UI',system-ui,sans-serif"),
 'rubik':("Rubik:wght@500;700","Nunito Sans:wght@400;600;700","'Rubik','Segoe UI',sans-serif","'Nunito Sans','Segoe UI',system-ui,sans-serif"),
 'playfair':("Playfair Display:wght@500;700","Lato:wght@400;700","'Playfair Display',Georgia,serif","'Lato','Segoe UI',system-ui,sans-serif"),
 'unbounded':("Unbounded:wght@500;700","Outfit:wght@400;500;600","'Unbounded','Segoe UI',sans-serif","'Outfit','Segoe UI',system-ui,sans-serif"),
}
def art(*parts): return '<svg viewBox="0 0 320 220" role="img" aria-label="Sample illustration" preserveAspectRatio="xMidYMid slice">'+''.join(parts)+'</svg>'
def r(x,y,w,h,f,rx=0): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}" rx="{rx}"/>'
def c(x,y,rad,f): return f'<circle cx="{x}" cy="{y}" r="{rad}" fill="{f}"/>'
def p(d,f='none',s=None,w=0): return f'<path d="{d}" fill="{f}"'+(f' stroke="{s}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"' if s else '')+'/>'

S=[]
def site(**k): S.append(k)

site(id='barber',name='Cutline Barbers',cat='Barber and salon',font='bebas',
 pal=dict(bg="#EFE9DF",panel="#F8F4EC",fg="#1A1A1A",mut="#5E5850",line="#D6CDBD",deep="#161616",ondeep="#F2EEE6",acc="#B3202A",onacc="#FFFFFF",accd="#E5484D",onaccd="#1A0709"),
 layout='split',eyebrow='Walk-ins and appointments',headline='Sharp cuts. No wait games.',lead='Fades, cuts, beard trims and hot towel shaves. Book a chair or walk in.',cta='Book a chair',
 hero=art(r(0,0,320,220,'#161616'),r(60,150,200,14,'#B3202A'),r(70,40,18,110,'#F2EEE6'),r(232,40,18,110,'#F2EEE6'),r(70,34,180,10,'#F2EEE6'),c(160,92,34,'#D9B99B'),p('M126 80q34-40 68 0v-12q-34-26-68 0z','#161616'),r(140,118,40,28,'#F2EEE6',4),p('M96 190h128','none','#F2EEE6',4)),
 svc_title='Services',svcs=[('Classic cut','Scissors or clippers, finished with a clean neckline'),('Skin fade','Tight blends from zero to whatever length you pick'),('Beard trim and shape','Line-up, shape and hot towel finish'),('Hot towel shave','Straight razor shave with hot towels'),('Kids cuts','Patient, quick, and the cape has dinosaurs'),('Cut and beard','The full reset in one visit')],
 sec2=('Meet the chairs',[('Chair 1','Fades and tapers'),('Chair 2','Classic cuts and shaves'),('Chair 3','Beards and line-ups')],'people'),
 gallery=[('Fresh fade','#3A3A3A'),('Beard line-up','#6B2A2E'),('Hot towel shave','#8A7355'),('Classic part','#2B3A4A')],
 form=dict(title='Book a chair',jobl='Service',extra=[('Preferred day','sel',['Weekday','Saturday','No preference']),('Preferred time','sel',['Morning','Afternoon','Evening'])],walk='I am okay with a walk-in slot if sooner'),
 hours=[(9,18),(9,18),(9,18),(9,19),(9,19),(8,16),(0,0)],area=['Downtown','Northside','Campus area'],phone='(555) 010-0171')

site(id='lawn',name='GreenEdge Lawn Care',cat='Lawn care and snow',font='rubik',
 pal=dict(bg="#EAF0E3",panel="#F6F9F1",fg="#17241A",mut="#516355",line="#CBD8C0",deep="#163321",ondeep="#EEF4E8",acc="#2F7D32",onacc="#FFFFFF",accd="#6BCB77",onaccd="#08160B"),
 layout='band',eyebrow='Lawn, landscape and snow',headline='A yard you stop thinking about.',lead='Mowing, edging, cleanups, mulch and snow removal on a schedule you set once.',cta='Get a quote',
 hero=art(r(0,0,320,220,'#BFE0F2'),c(260,40,22,'#FFE08A'),r(0,130,320,90,'#4E9F3D'),r(0,150,320,70,'#3F8A33'),r(0,170,320,50,'#347A2B'),r(60,60,70,60,'#E8DFCF'),p('M52 66l43-30 43 30','none','#B3552B',7),r(88,88,14,32,'#7BA3BC'),r(200,70,10,50,'#6B4A2B'),c(205,62,26,'#2F6B2C'),r(140,175,120,10,'#C6D9B0',3)),
 svc_title='What we do',svcs=[('Weekly mowing','Mow, trim, edge and blow clean'),('Spring and fall cleanup','Leaves, debris, beds and haul-away'),('Mulch and beds','Fresh edges and mulch laid in'),('Trimming and pruning','Shrubs and small trees'),('Aeration and seed','Thicker turf for next season'),('Snow removal','Driveways and walks, per storm or seasonal')],
 sec2=('How it works',[('Tell us the yard','Address and a few photos'),('We quote it','Written price for the season or the job'),('We show up','Same crew, same day each week')],'steps'),
 gallery=[('Fresh stripes','#3F8A33'),('Clean beds','#7A5A3A'),('Fall cleanup','#B5651D'),('Winter driveway','#7F9DB5')],
 form=dict(title='Get a lawn quote',jobl='Service',extra=[('Yard size','sel',['Small','Medium','Large','Not sure']),('Schedule','sel',['One time','Weekly','Every other week','Seasonal contract'])],walk=None),
 hours=[(7,18),(7,18),(7,18),(7,18),(7,17),(8,13),(0,0)],area=['Ames','Ankeny','Boone','Huxley','Slater','Nevada'],phone='(555) 010-0188')

site(id='clean',name='Brightside Cleaning',cat='Cleaning and detailing',font='dmserif',
 pal=dict(bg="#E9F3F5",panel="#F5FAFB",fg="#10272D",mut="#4F6A72",line="#C5DADF",deep="#0F3A45",ondeep="#E9F6F8",acc="#0B7285",onacc="#FFFFFF",accd="#4FD1E0",onaccd="#062329"),
 layout='center',eyebrow='Homes, offices and move-outs',headline='Come home to clean.',lead='Pick a package, pick a day. We bring the supplies and the checklist.',cta='Book a clean',
 hero=art(r(0,0,320,220,'#CDEBF0'),r(90,70,140,110,'#F5FAFB'),r(90,70,140,14,'#0B7285'),r(110,100,40,34,'#BFE3EA'),r(170,100,40,34,'#BFE3EA'),r(135,140,50,40,'#8CCAD6'),c(60,50,6,'#fff'),c(260,60,9,'#fff'),c(270,150,5,'#fff'),c(48,150,8,'#fff'),p('M230 40l6 12 12 6-12 6-6 12-6-12-12-6 12-6z','#fff')),
 svc_title='Packages',svcs=[('Standard clean','Kitchens, baths, floors, dusting'),('Deep clean','Baseboards, inside appliances, detail work'),('Move in or out','Empty-home reset for deposits and handoffs'),('Office clean','After-hours, weekly or nightly'),('Car interior detail','Vacuum, wipe-down, windows'),('Add-ons','Fridge, oven, windows, laundry fold')],
 sec2=('Our checklist',[('Kitchen','Counters, sink, appliance fronts, floor'),('Bathrooms','Tub, toilet, mirrors, floor'),('Living areas','Dust, vacuum, mop, trash out')],'steps'),
 gallery=[('Kitchen reset','#8CCAD6'),('Bathroom shine','#B6D8E0'),('Move-out ready','#6FB1C0'),('Car interior','#3C7F8F')],
 form=dict(title='Book a cleaning',jobl='Package',extra=[('Home size','sel',['Studio or 1 bed','2 to 3 bed','4+ bed','Office']),('How often','sel',['One time','Weekly','Every 2 weeks','Monthly'])],walk=None),
 hours=[(8,17),(8,17),(8,17),(8,17),(8,17),(9,13),(0,0)],area=['Ames','Ankeny','West Des Moines'],phone='(555) 010-0152')

site(id='truck',name='Smokestack Taco Truck',cat='Food truck',font='unbounded',
 pal=dict(bg="#FFF1D6",panel="#FFF9EA",fg="#2B1408",mut="#6B4A32",line="#EBCFA0",deep="#2B1408",ondeep="#FFF1D6",acc="#E4572E",onacc="#FFFFFF",accd="#FF8A5C",onaccd="#2B1408"),
 layout='band',eyebrow='Find the truck today',headline='Tacos off the grill, on four wheels.',lead='Check where we are, see the menu and order ahead for pickup.',cta='Order ahead',
 hero=art(r(0,0,320,220,'#FFC857'),r(0,170,320,50,'#5B4636'),r(40,80,200,80,'#E4572E',8),r(40,80,200,16,'#2B1408'),r(60,106,90,34,'#FFF1D6',3),r(170,106,50,54,'#2B1408',3),r(230,100,40,60,'#E4572E',6),c(80,170,18,'#2B1408'),c(80,170,8,'#999'),c(210,170,18,'#2B1408'),c(210,170,8,'#999'),p('M60 80l-6-22h192l-6 22','#FFF1D6'),r(100,56,10,14,'#2B1408'),c(270,40,20,'#fff')),
 svc_title='The menu',svcs=[('Carne asada tacos','Grilled steak, onion, cilantro, lime'),('Chicken al pastor','Marinated chicken, pineapple, salsa'),('Veggie tacos','Grilled peppers, black beans, slaw'),('Quesadilla','Cheese and your choice of meat'),('Loaded fries','Fries, cheese, meat, crema'),('Drinks','Horchata and fountain')],
 sec2=('This week',[('Mon to Wed','Lunch at the downtown lot'),('Thursday','Evening near campus'),('Fri and Sat','Events and breweries')],'events'),
 gallery=[('Fresh off the grill','#E4572E'),('Salsa bar','#7A9E3C'),('Lunch line','#FFB627'),('The truck','#2B1408')],
 form=dict(title='Order ahead',jobl='Main item',extra=[('How many','sel',['1','2','3 to 4','Group order']),('Pickup spot','sel',['Today\'s lot','Event location'])],walk=None),
 hours=[(11,14),(11,14),(11,14),(17,21),(11,21),(12,21),(0,0)],area=['Downtown lot','Campus','Breweries'],phone='(555) 010-0133')

site(id='bakery',name='Rise & Crumb Bakery',cat='Home bakery',font='fraunces',
 pal=dict(bg="#F8EDE3",panel="#FFF8F1",fg="#3A2418",mut="#7A5B4A",line="#E8D2C0",deep="#4A2B1B",ondeep="#F8EDE3",acc="#C2415D",onacc="#FFFFFF",accd="#F28DA3",onaccd="#3A0E1A"),
 layout='split',eyebrow='Baked to order',headline='Cakes and bakes made for your table.',lead='Custom cakes, cookies, breads and pastry boxes. Order a week ahead.',cta='Start an order',
 hero=art(r(0,0,320,220,'#F6D5C6'),r(60,150,200,12,'#E8D2C0'),r(90,100,140,50,'#F2C9A0',6),r(90,100,140,18,'#C2415D',6),r(105,70,110,34,'#F6E3D0',6),r(105,70,110,12,'#E58AA0',6),r(125,44,70,28,'#F2C9A0',6),c(160,34,8,'#C2415D'),r(158,16,4,14,'#7A5B4A'),c(100,95,4,'#fff'),c(160,95,4,'#fff'),c(220,95,4,'#fff')),
 svc_title='What we bake',svcs=[('Custom cakes','Birthdays, weddings, showers'),('Cupcakes and cookies','By the dozen, decorated or plain'),('Sourdough and bread','Weekly loaves, pre-order'),('Pastry boxes','Croissants, scones, cinnamon rolls'),('Gluten-free options','Ask which items can be made GF'),('Party platters','Bars and bites for groups')],
 sec2=('How ordering works',[('Tell us the occasion','Date, servings and flavors'),('We confirm','Design, timing and pickup'),('Pick it up','Fresh on the day')],'steps'),
 gallery=[('Layer cake','#E58AA0'),('Cinnamon rolls','#C98B5B'),('Sourdough','#A8744A'),('Cookie box','#8F5B3C')],
 form=dict(title='Start an order',jobl='What are you ordering',extra=[('Servings','sel',['6 to 10','12 to 24','25 to 50','50+']),('Needed by','sel',['This week','Next week','In a month','Later'])],walk=None),
 hours=[(0,0),(8,14),(8,14),(8,14),(8,16),(8,13),(0,0)],area=['Pickup in Ames','Local delivery on request'],phone='(555) 010-0126')

site(id='auto',name='Torque Auto Repair',cat='Auto repair',font='saira',
 pal=dict(bg="#E6E9EC",panel="#F3F5F7",fg="#14181C",mut="#515B65",line="#C9D0D6",deep="#14181C",ondeep="#EEF1F3",acc="#0066CC",onacc="#FFFFFF",accd="#59A5FF",onaccd="#04162B"),
 layout='split',eyebrow='Honest repairs, clear estimates',headline='We find it. We explain it. Then we fix it.',lead='Brakes, oil, tires, diagnostics and more. Request an appointment and tell us what the car is doing.',cta='Request an appointment',
 hero=art(r(0,0,320,220,'#1C2430'),r(0,160,320,60,'#2B3340'),p('M50 150q10-50 60-56h100q40 6 56 56z','#0066CC'),r(120,98,80,34,'#BFD9F5',6),c(100,156,22,'#0B0F14'),c(100,156,10,'#9AA4AD'),c(230,156,22,'#0B0F14'),c(230,156,10,'#9AA4AD'),r(270,60,30,80,'#F2B705'),r(276,60,18,8,'#14181C')),
 svc_title='Services',svcs=[('Oil change and fluids','Synthetic and conventional'),('Brakes','Pads, rotors, inspection'),('Tires and alignment','Mount, balance, rotate'),('Check engine diagnostics','Scan, test, written findings'),('Suspension and steering','Shocks, struts, tie rods'),('Pre-trip inspection','Check it before the road trip')],
 sec2=('Our process',[('You describe it','Noises, lights, what changed'),('We inspect','Findings in plain language'),('You approve','No work without your OK')],'steps'),
 gallery=[('The bay','#2B3340'),('Brake job','#0066CC'),('Tire rack','#4A545F'),('Diagnostics','#1C2430')],
 form=dict(title='Request an appointment',jobl='Service',extra=[('Vehicle','txt','Year, make and model'),('Drop-off','sel',['Morning','Afternoon','Wait while I stay'])],walk=None),
 hours=[(7,18),(7,18),(7,18),(7,18),(7,18),(8,13),(0,0)],area=['Ames','Gilbert','Story City'],phone='(555) 010-0164')

site(id='photo',name='Frame & Light Studio',cat='Photographer',font='playfair',
 pal=dict(bg="#F3EFE8",panel="#FBF9F5",fg="#1D1B18",mut="#6A645B",line="#DDD6C8",deep="#1D1B18",ondeep="#F3EFE8",acc="#8A5A2B",onacc="#FFFFFF",accd="#D9A566",onaccd="#1D1B18"),
 layout='center',eyebrow='Weddings, portraits, places',headline='Stories told in light.',lead='Full galleries delivered online. Prints and albums made to be held.',cta='Check availability',
 hero=art(r(0,0,320,220,'#2A2724'),r(40,30,240,160,'#F3EFE8'),r(52,42,216,136,'#6F7F73'),p('M52 150l60-50 40 30 50-60 66 80v28H52z','#3E4A42'),c(220,76,16,'#E8D9A8'),r(0,196,320,24,'#1D1B18')),
 svc_title='Sessions',svcs=[('Weddings','Full-day coverage and a complete gallery'),('Portraits','Individual, family and senior sessions'),('Events','Parties, reunions and corporate'),('Landscapes and prints','Fine-art prints of local scenes'),('Albums','Hand-bound keepsake albums'),('Mini sessions','Short seasonal slots')],
 sec2=('Selected galleries',[('Weddings','Quiet, honest days'),('Portraits','Natural light'),('Places','Dawn and dusk')],'people'),
 gallery=[('Wedding day','#B9A58A'),('Portrait','#8C7B6B'),('Landscape','#6F7F73'),('City','#3D4A57')],
 form=dict(title='Check a date',jobl='Session type',extra=[('Event date','txt','Month and day, or flexible'),('Location','txt','Venue or town')],walk=None),
 hours=[(10,16),(10,16),(10,16),(10,16),(10,16),(0,0),(0,0)],area=['Central Iowa','Travel available'],phone='(555) 010-0119')

site(id='dj',name='Nightshift Sound',cat='Musician and DJ',font='syne',
 pal=dict(bg="#14101F",panel="#1D1830",fg="#F2EEFF",mut="#A79FC6",line="#2F2750",deep="#0B0814",ondeep="#F2EEFF",acc="#B26BFF",onacc="#120A24",accd="#C99BFF",onaccd="#120A24"),
 layout='band',eyebrow='Weddings, parties, clubs',headline='Make the room move.',lead='DJ sets, sound and lighting for weddings, parties and venues. Check a date and request a set.',cta='Check my date',
 hero=art(r(0,0,320,220,'#0B0814'),p('M0 150l60-70 50 50 50-90 60 100 50-60 50 70v70H0z','#2A1E4D'),c(160,110,52,'#1D1830'),c(160,110,40,'#0B0814'),c(160,110,10,'#B26BFF'),p('M160 110m-30 0a30 30 0 0 1 60 0','none','#B26BFF',3),r(40,176,240,16,'#B26BFF',8),p('M70 60l30 30M250 60l-30 30M160 30v40','none','#C99BFF',3)),
 svc_title='Sets and gear',svcs=[('Wedding DJ','Ceremony, cocktail hour and reception'),('Private parties','Birthdays, grad parties, reunions'),('Venue nights','Residencies and one-offs'),('Sound and lighting','Speakers, mics and dance lighting'),('MC services','Announcements and timeline help'),('Custom playlists','Your must-plays and do-not-plays')],
 sec2=('Upcoming',[('Sample date','Rooftop night'),('Sample date','Wedding reception'),('Sample date','Club set')],'events'),
 gallery=[('Dance floor','#B26BFF'),('The rig','#2A1E4D'),('Booth view','#5A3BA0'),('Crowd','#8250D9')],
 form=dict(title='Check a date',jobl='Event type',extra=[('Event date','txt','Month and day'),('Guests','sel',['Under 50','50 to 150','150 to 300','300+'])],walk=None),
 hours=[(10,18),(10,18),(10,18),(10,18),(10,18),(0,0),(0,0)],area=['Central Iowa','Travel available'],phone='(555) 010-0192')

site(id='realty',name='Harbor & Oak Realty',cat='Real estate agent',font='dmserif',
 pal=dict(bg="#EEF1F4",panel="#F8FAFB",fg="#15202B",mut="#566574",line="#D0D8E0",deep="#16283A",ondeep="#EEF4FA",acc="#1B6F5C",onacc="#FFFFFF",accd="#4FC3A8",onaccd="#06211B"),
 layout='split',eyebrow='Buying and selling',headline='Know your next move before you make it.',lead='Local listings, honest pricing talk and a plan for every step from offer to keys.',cta='Talk to an agent',
 hero=art(r(0,0,320,220,'#CFE0EE'),r(0,150,320,70,'#6FA07F'),r(70,70,110,80,'#F8FAFB'),p('M60 76l65-44 65 44','#1B6F5C'),r(108,104,34,46,'#1B6F5C'),r(80,90,18,18,'#9DC3DF'),r(152,90,18,18,'#9DC3DF'),r(200,96,60,54,'#E7EDF2'),p('M192 100l38-28 38 28','#16283A'),r(224,120,16,30,'#16283A'),r(290,110,6,40,'#6B4A2B'),c(293,102,18,'#2F6B2C')),
 svc_title='How I help',svcs=[('Buyer representation','Search, tours, offers and negotiation'),('Selling your home','Pricing, prep, photos and marketing'),('Market snapshots','What similar homes are doing nearby'),('First-time buyers','Walk through every step and cost'),('Relocation','Moving to or from the area'),('Investment properties','Rentals and small multi-family')],
 sec2=('Featured listings',[('Sample listing','3 bed, 2 bath near the park'),('Sample listing','4 bed on a quiet cul-de-sac'),('Sample listing','2 bed condo, walkable')],'listings'),
 gallery=[('Front exterior','#7FA2BF'),('Kitchen','#C9B79C'),('Living room','#8C9DAE'),('Backyard','#6FA07F')],
 form=dict(title='Talk to an agent',jobl='I want to',extra=[('Timeline','sel',['Now','In 3 months','In 6 months','Just looking']),('Area','txt','Town or neighborhood')],walk=None),
 hours=[(9,17),(9,17),(9,17),(9,17),(9,17),(10,14),(0,0)],area=['Ames','Ankeny','Des Moines metro'],phone='(555) 010-0147')

site(id='church',name='Cornerstone Community Church',cat='Church or nonprofit',font='fraunces',
 pal=dict(bg="#F4EFE6",panel="#FBF8F2",fg="#222B35",mut="#5E6772",line="#DDD5C5",deep="#2A3A52",ondeep="#F4EFE6",acc="#B5651D",onacc="#FFFFFF",accd="#F0A560",onaccd="#2B1606"),
 layout='center',eyebrow='All are welcome',headline='A place to belong.',lead='Join us Sunday, find an event or sign up to volunteer. Ask the assistant anything about visiting.',cta='Plan a visit',
 hero=art(r(0,0,320,220,'#E8D9B8'),r(0,160,320,60,'#7A9A6B'),r(100,90,120,70,'#F8F3E8'),p('M90 96l70-44 70 44','#2A3A52'),r(150,30,20,30,'#F8F3E8'),r(158,14,4,22,'#B5651D'),r(148,22,24,4,'#B5651D'),r(142,112,36,48,'#B5651D',18),r(108,112,20,24,'#9DC3DF'),r(192,112,20,24,'#9DC3DF')),
 svc_title='Get involved',svcs=[('Sunday gathering','Sample time. Worship and kids programs'),('Small groups','Midweek groups in homes'),('Serve and volunteer','Food pantry, hospitality, setup'),('Kids and youth','Safe, friendly programs by age'),('Prayer and care','Request prayer or a visit'),('Give','A simple way to support the work')],
 sec2=('Coming up',[('Sample date','Community meal'),('Sample date','Volunteer day'),('Sample date','Youth night')],'events'),
 gallery=[('Sunday morning','#B5651D'),('Community meal','#7A9A6B'),('Service day','#2A3A52'),('Kids program','#C28A3A')],
 form=dict(title='Plan a visit or volunteer',jobl='I am interested in',extra=[('Group size','sel',['Just me','2 to 3','Family of 4+']),('Questions','txt','Anything we can help with')],walk=None),
 hours=[(0,0),(9,15),(9,15),(9,15),(9,15),(0,0),(9,12)],area=['Ames and surrounding towns'],phone='(555) 010-0108')

site(id='tutor',name='Northstar Tutoring',cat='Tutor or coach',font='rubik',
 pal=dict(bg="#EEF0FA",panel="#F8F9FE",fg="#1A1F3D",mut="#575E86",line="#D2D6EE",deep="#1D2A66",ondeep="#EEF0FA",acc="#3B4FE0",onacc="#FFFFFF",accd="#8C9BFF",onaccd="#0B1240"),
 layout='split',eyebrow='Math, reading and test prep',headline='Confidence is a skill. We teach it.',lead='One-on-one sessions that fit your schedule. Pick a subject and a time and get started.',cta='Book a session',
 hero=art(r(0,0,320,220,'#D8DDFB'),r(50,40,220,140,'#F8F9FE',8),r(50,40,220,18,'#3B4FE0',8),p('M80 90h90M80 110h120M80 130h70','none','#8C9BFF',6),c(230,110,26,'#3B4FE0'),p('M218 110l9 9 16-18','none','#fff',5),r(60,186,200,8,'#1D2A66',4)),
 svc_title='Subjects',svcs=[('Math','Arithmetic through calculus'),('Reading and writing','Comprehension, essays, study habits'),('Science','Biology, chemistry, physics'),('Test prep','ACT, SAT and placement tests'),('Homework help','Weekly check-ins and structure'),('Adult learners','GED, certifications, career change')],
 sec2=('How sessions work',[('Pick a subject','Tell us the goal and grade level'),('Meet your tutor','A first session to find the right plan'),('Track progress','Short notes after each session')],'steps'),
 gallery=[('Session','#3B4FE0'),('Study plan','#8C9BFF'),('Practice set','#1D2A66'),('Progress notes','#5A6AE8')],
 form=dict(title='Book a session',jobl='Subject',extra=[('Student level','sel',['Elementary','Middle school','High school','College or adult']),('Format','sel',['In person','Online','Either'])],walk=None),
 hours=[(15,20),(15,20),(15,20),(15,20),(15,18),(9,13),(0,0)],area=['Ames and online'],phone='(555) 010-0175')

site(id='gym',name='Ironwood Fitness',cat='Gym or trainer',font='bebas',
 pal=dict(bg="#EEEEEC",panel="#F8F8F6",fg="#141414",mut="#555555",line="#D4D4D0",deep="#141414",ondeep="#F2F2EE",acc="#E0481F",onacc="#FFFFFF",accd="#FF7A52",onaccd="#1A0A04"),
 layout='band',eyebrow='Classes and coaching',headline='Show up. We will handle the plan.',lead='Strength classes, personal training and a schedule you can actually keep.',cta='Try a class',
 hero=art(r(0,0,320,220,'#141414'),r(0,160,320,60,'#232323'),r(40,102,240,10,'#9A9A9A',5),r(30,86,14,42,'#E0481F',3),r(46,92,10,30,'#E0481F',3),r(276,86,14,42,'#E0481F',3),r(264,92,10,30,'#E0481F',3),c(160,60,16,'#D9B99B'),r(144,78,32,24,'#E0481F',4),p('M120 150h80','none','#555',4)),
 svc_title='Programs',svcs=[('Strength class','Coached barbell and bodyweight work'),('Personal training','One-on-one plans'),('Small group training','3 to 6 people, shared coaching'),('Conditioning','Intervals and cardio circuits'),('Beginner start','Learn the basics without pressure'),('Open gym','Self-guided time with equipment')],
 sec2=('This week',[('Mon and Wed','Strength classes'),('Tue and Thu','Conditioning'),('Saturday','Open gym and mobility')],'events'),
 gallery=[('Barbell room','#E0481F'),('Class time','#3A3A3A'),('Coaching','#6B6B6B'),('Open gym','#262626')],
 form=dict(title='Try a class',jobl='Interested in',extra=[('Experience','sel',['New to lifting','Some experience','Experienced']),('Preferred time','sel',['Morning','Midday','Evening'])],walk=None),
 hours=[(5,21),(5,21),(5,21),(5,21),(5,20),(7,14),(8,12)],area=['Ames'],phone='(555) 010-0186')


# Each additional business retains its own content, composition and imagery.
from new_sites import register
register(site)
