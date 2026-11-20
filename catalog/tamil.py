"""Tamil names for base products in the starter catalogue.

Only names in common Tamil Nadu shop use are filled in. Anything missing is left
blank (shown as 'Tamil name needed' in Products) rather than guessed. The store
should review these before printing them on shelf labels.
"""

BASE_TAMIL = {
    # Fruit
    "Alphonso mango": "அல்போன்சா மாம்பழம்", "Amla": "நெல்லிக்காய்", "Apple": "ஆப்பிள்", "Avocado": "அவகேடோ",
    "Banganapalli mango": "பங்கனப்பள்ளி மாம்பழம்", "Black grapes": "கருப்பு திராட்சை", "Custard apple": "சீதாப்பழம்",
    "Dragon fruit": "டிராகன் பழம்", "Green grapes": "பச்சை திராட்சை", "Guava": "கொய்யா", "Hill banana": "மலை வாழைப்பழம்",
    "Imam Pasand mango": "இமாம் பசந்த் மாம்பழம்", "Jackfruit bulbs": "பலாச்சுளை", "Kiwi": "கிவி", "Mandarin": "கமலா ஆரஞ்சு",
    "Muskmelon": "முலாம்பழம்", "Nendran banana": "நேந்திரம் பழம்", "Papaya": "பப்பாளி", "Pear": "பேரிக்காய்",
    "Pineapple": "அன்னாசிப்பழம்", "Pink guava": "சிவப்பு கொய்யா", "Pomegranate": "மாதுளை", "Poovan banana": "பூவன் வாழைப்பழம்",
    "Rasthali banana": "ரஸ்தாளி வாழைப்பழம்", "Red banana": "செவ்வாழை", "Robusta banana": "ரோபஸ்டா வாழைப்பழம்",
    "Sapota": "சப்போட்டா", "Sweet lime": "சாத்துக்குடி", "Totapuri mango": "தோத்தாபுரி மாம்பழம்", "Watermelon": "தர்பூசணி",
    # Vegetables and greens
    "Amaranth greens": "முளைக்கீரை", "Ash gourd": "வெள்ளைப் பூசணி", "Beetroot": "பீட்ரூட்", "Bitter gourd": "பாகற்காய்",
    "Bottle gourd": "சுரைக்காய்", "Brinjal": "கத்தரிக்காய்", "Broad beans": "அவரைக்காய்", "Broccoli": "ப்ரோக்கோலி",
    "Cabbage": "முட்டைக்கோஸ்", "Capsicum": "குடைமிளகாய்", "Carrot": "கேரட்", "Cauliflower": "காலிஃபிளவர்",
    "Chow chow": "சௌசௌ", "Cluster beans": "கொத்தவரங்காய்", "Colocasia": "சேப்பங்கிழங்கு", "Coriander leaves": "கொத்தமல்லி தழை",
    "Cucumber": "வெள்ளரிக்காய்", "Curry leaves": "கறிவேப்பிலை", "Drumstick": "முருங்கைக்காய்", "French beans": "பீன்ஸ்",
    "Garlic": "பூண்டு", "Ginger": "இஞ்சி", "Green chilli": "பச்சை மிளகாய்", "Green peas": "பச்சைப் பட்டாணி",
    "Ivy gourd": "கோவைக்காய்", "Mint": "புதினா", "Okra": "வெண்டைக்காய்", "Potato": "உருளைக்கிழங்கு", "Radish": "முள்ளங்கி",
    "Raw banana": "வாழைக்காய்", "Red onion": "பெரிய வெங்காயம்", "Ridge gourd": "பீர்க்கங்காய்", "Small onion": "சின்ன வெங்காயம்",
    "Snake gourd": "புடலங்காய்", "Spinach": "பசலைக்கீரை", "Sweet potato": "சர்க்கரைவள்ளிக் கிழங்கு", "Tomato": "தக்காளி",
    "Yam": "சேனைக்கிழங்கு", "Yellow pumpkin": "மஞ்சள் பூசணி",
    # Rice and millets
    "Barnyard millet": "குதிரைவாலி", "Basmati rice": "பாஸ்மதி அரிசி", "Finger millet": "கேழ்வரகு", "Foxtail millet": "தினை",
    "Idli rice": "இட்லி அரிசி", "Karuppu kavuni rice": "கருப்பு கவுனி அரிசி", "Kichili samba rice": "கிச்சிலி சம்பா அரிசி",
    "Kodo millet": "வரகு", "Little millet": "சாமை", "Mappillai samba rice": "மாப்பிள்ளை சம்பா அரிசி", "Matta rice": "மட்டை அரிசி",
    "Pearl millet": "கம்பு", "Ponni rice": "பொன்னி அரிசி", "Proso millet": "பனிவரகு", "Seeraga samba rice": "சீரக சம்பா அரிசி",
    "Sona masoori rice": "சோனா மசூரி அரிசி", "Sorghum": "வெள்ளைச் சோளம்",
    # Pulses
    "Black chickpeas": "கருப்பு கொண்டைக்கடலை", "Chana dal": "கடலைப் பருப்பு", "Cowpeas": "காராமணி", "Field beans": "மொச்சை",
    "Green gram": "பச்சைப் பயறு", "Horse gram": "கொள்ளு", "Kabuli chana": "வெள்ளை கொண்டைக்கடலை", "Masoor dal": "மசூர் பருப்பு",
    "Moong dal": "பாசிப் பருப்பு", "Rajma": "ராஜ்மா", "Soybeans": "சோயா பீன்ஸ்", "Toor dal": "துவரம் பருப்பு",
    "Urad dal": "உளுத்தம் பருப்பு", "White peas": "வெள்ளைப் பட்டாணி",
    # Flours
    "Bajra flour": "கம்பு மாவு", "Barnyard millet flour": "குதிரைவாலி மாவு", "Besan": "கடலை மாவு", "Corn flour": "சோள மாவு",
    "Foxtail millet flour": "தினை மாவு", "Idiyappam flour": "இடியாப்ப மாவு", "Jowar flour": "வெள்ளைச் சோள மாவு", "Maida": "மைதா",
    "Multi-millet flour": "சிறுதானிய மாவு", "Puttu flour": "புட்டு மாவு", "Ragi flour": "கேழ்வரகு மாவு", "Rice flour": "அரிசி மாவு",
    "Tapioca flour": "மரவள்ளிக்கிழங்கு மாவு", "Wheat atta": "கோதுமை மாவு",
    # Oils
    "Coconut oil": "தேங்காய் எண்ணெய்", "Groundnut oil": "கடலை எண்ணெய்", "Mustard oil": "கடுகு எண்ணெய்",
    "Sesame oil": "நல்லெண்ணெய்", "Sunflower oil": "சூரியகாந்தி எண்ணெய்",
    # Spices
    "Black pepper": "மிளகு", "Cardamom": "ஏலக்காய்", "Carom seed": "ஓமம்", "Cinnamon": "பட்டை", "Clove": "கிராம்பு",
    "Coriander seed": "மல்லி (தனியா)", "Cumin": "சீரகம்", "Dry ginger": "சுக்கு", "Dry red chilli": "காய்ந்த மிளகாய்",
    "Fennel": "சோம்பு", "Fenugreek": "வெந்தயம்", "Mustard seed": "கடுகு", "Nutmeg": "ஜாதிக்காய்", "Star anise": "அன்னாசிப்பூ",
    "Turmeric": "மஞ்சள்",
    # Salt and sweeteners
    "Brown sugar": "பழுப்புச் சர்க்கரை", "Cane sugar": "சர்க்கரை", "Iodised salt": "அயோடின் உப்பு", "Jaggery powder": "வெல்லத் தூள்",
    "Palm jaggery": "கருப்பட்டி", "Palm sugar": "பனங்கற்கண்டு", "Rock salt": "இந்துப்பு", "Sea salt": "கல் உப்பு",
    # Dairy and eggs
    "Curd": "தயிர்", "Ghee": "நெய்", "Paneer": "பனீர்", "Salted butter": "உப்பு வெண்ணெய்", "Unsalted butter": "வெண்ணெய்",
    "Buttermilk": "மோர்", "Badam milk": "பாதாம் பால்", "Rose milk": "ரோஸ் மில்க்",
    "Country hen eggs": "நாட்டுக்கோழி முட்டை", "Duck eggs": "வாத்து முட்டை", "Hen eggs": "கோழி முட்டை", "Quail eggs": "காடை முட்டை",
    # Dried fruit, nuts, seeds
    "Dates": "பேரீச்சம்பழம்", "Figs": "அத்திப்பழம்", "Raisins": "உலர் திராட்சை", "Almonds": "பாதாம்", "Cashews": "முந்திரி",
    "Peanuts": "வேர்க்கடலை", "Pistachios": "பிஸ்தா", "Sesame seeds": "எள்", "Walnuts": "வால்நட்", "Sunflower seeds": "சூரியகாந்தி விதை",
    "Pumpkin seeds": "பூசணி விதை",
    # Savouries and mixes
    "Banana chips": "வாழைக்காய் சிப்ஸ்", "Murukku": "முறுக்கு", "Ribbon pakoda": "ரிப்பன் பக்கோடா", "Thattai": "தட்டை",
    "Omapodi": "ஓமப்பொடி", "Kara sev": "காரசேவ்", "Bombay mixture": "மிக்சர்", "Tapioca chips": "மரவள்ளிக்கிழங்கு சிப்ஸ்",
    "Potato chips": "உருளைக்கிழங்கு சிப்ஸ்", "Roasted chana": "பொட்டுக்கடலை",
    "Sambar": "சாம்பார் பொடி", "Rasam": "ரசப் பொடி", "Kuzhambu": "குழம்பு மிளகாய்த் தூள்", "Garam masala": "கரம் மசாலா",
    "Biryani": "பிரியாணி மசாலா", "Chettinad curry": "செட்டிநாடு மசாலா",
    "Adai mix": "அடை மாவு", "Appam mix": "ஆப்ப மாவு", "Rava idli mix": "ரவா இட்லி மிக்ஸ்", "Ven pongal mix": "வெண் பொங்கல் மிக்ஸ்",
    "Upma mix": "உப்புமா மிக்ஸ்", "Ragi dosa mix": "கேழ்வரகு தோசை மிக்ஸ்",
    # Tea and coffee
    "Filter coffee": "ஃபில்டர் காபி", "Instant coffee": "இன்ஸ்டன்ட் காபி", "Green tea": "கிரீன் டீ", "Masala tea": "மசாலா டீ",
    "Nilgiri tea": "நீலகிரி டீ",
    # Pickles
    "Mango pickle": "மாங்காய் ஊறுகாய்", "Lime pickle": "எலுமிச்சை ஊறுகாய்", "Garlic pickle": "பூண்டு ஊறுகாய்",
    "Ginger pickle": "இஞ்சி ஊறுகாய்", "Amla pickle": "நெல்லிக்காய் ஊறுகாய்", "Tomato pickle": "தக்காளி ஊறுகாய்",
    "Citron pickle": "நார்த்தங்காய் ஊறுகாய்", "Green chilli pickle": "பச்சை மிளகாய் ஊறுகாய்",
    "Mixed vegetable pickle": "கலவை காய்கறி ஊறுகாய்", "Gongura pickle": "கோங்குரா ஊறுகாய்",
    # Household and pooja
    "Incense sticks": "ஊதுபத்தி", "Bathing soap": "குளியல் சோப்பு", "Laundry soap": "துணி சோப்பு",
    "Dishwashing bar": "பாத்திரம் கழுவும் சோப்பு", "White bread": "வெள்ளை ரொட்டி",
}
