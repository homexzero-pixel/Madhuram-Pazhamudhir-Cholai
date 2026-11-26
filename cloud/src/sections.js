'use strict';
// Shop sections: the online shop groups products the way customers look for them (vegetables, fruits, munchies, bath & body…).
// Worked out from the product name first (the shop's own categories mix many kinds of products), then the category.
// The owner can fix any product by choosing its section in the product dialog (items.shop_section).
const db = require('./db');

const GROUPS = [
  ['grocery', 'Grocery & Kitchen'], ['snacks', 'Snacks & Drinks'], ['beauty', 'Beauty & Personal Care'],
  ['household', 'Household Essentials'], ['hobbies', 'Hobbies & Interest'],
];
// key, name, group
const SECTIONS = [
  ['veg', 'Fresh Vegetables', 'grocery'], ['fruits', 'Fresh Fruits', 'grocery'], ['exotics', 'Exotics & Premium', 'grocery'],
  ['dairy', 'Dairy, Bread & Eggs', 'grocery'], ['staples', 'Atta, Rice, Oil & Dals', 'grocery'], ['masala', 'Masala & Dry Fruits', 'grocery'],
  ['breakfast', 'Breakfast & Sauces', 'grocery'], ['packaged', 'Packaged Food', 'grocery'],
  ['tea', 'Tea, Coffee & Health Drinks', 'snacks'], ['icecream', 'Ice Creams & Desserts', 'snacks'], ['drinks', 'Cold Drinks & Juices', 'snacks'],
  ['juicebar', 'Fresh Juice & Snacks', 'snacks'], ['munchies', 'Munchies', 'snacks'], ['biscuits', 'Biscuits & Cakes', 'snacks'],
  ['sweets', 'Chocolates & Sweets', 'snacks'],
  ['bath', 'Bath & Body', 'beauty'], ['hair', 'Hair Care', 'beauty'], ['skin', 'Skin & Face Care', 'beauty'], ['oral', 'Oral Care', 'beauty'],
  ['fragrance', 'Fragrances & Deos', 'beauty'], ['shaving', 'Shaving & Grooming', 'beauty'], ['baby', 'Baby Care', 'beauty'],
  ['pharma', 'Pharma & Wellness', 'beauty'],
  ['cleaning', 'Cleaning Essentials', 'household'], ['laundry', 'Detergents & Laundry', 'household'],
  ['fresheners', 'Fresheners & Repellents', 'household'], ['pooja', 'Pooja Needs', 'household'], ['disposables', 'Kitchen & Disposables', 'household'],
  ['kids', 'Toys, Kids & Stationery', 'hobbies'],
];
const KEYS = new Set(SECTIONS.map((s) => s[0]));

// ---------------------------------------------------------------- fresh produce (the shop's Vegetables category holds fruits too)
const EXOTIC = /brocc|brocli|zucchini|sukkuni|lettuce|lettisce|celery|chellery|red cabb|chinese cabb|baby ?corn|mushroom|avocado|butter ?fruit|kiwi|drag[oa]n|blue ?berr|\busa\b|\bus\b|washingt|fuji|royal ?gala|golden apple|green apple|cherr|plums|litchi|mangosteen|manghustan|red pears|golden pears|china pears|red capsicum|yellow capsicum|imported/;
const FRUIT = /apple|banana|bannana|grape|mango|orange|sweet ?lime|mosambi|sathukudi|kamala|malta|pomegranate|pomogranat|pomagranate|papaya|pappaya|pineapple|guava|sapota|sappota|chikoo|custard|star ?fru|star ?furit|melon|kirni|\bfig\b|pears?\b|peary|plum|jack ?fruit|litchi|cherr|kiwi|strawberr|drag[oa]n|amla|naval ?pazham|jamun|sugar ?cane|berry|nendram|rasthali|karpur|karpoor|yelakki|poovan/;
const NOT_FRUIT = /\braw\b|flower|leaf|steem|stem|valai|vazhai|plantain|vadu mango|bajji/;

// ---------------------------------------------------------------- everything else, by name (first match wins)
const NAME_RULES = [
  [/^(?!.*\bshake\b).*(ice ?cream|\bcone\b|kulfi|cornetto|sundae|cassata|frozen dessert|\barun\b)/, 'icecream'],
  [/baking ?(soda|powder)|\byeast\b|custard powder|corn ?flour/, 'staples'],
  [/^(?!.*(\d+\s*(ml|ltr|lit|l)\b|frooti|maaza|slice|\breal\b|tropicana|\btrop\b|b ?natural|paper ?boat|amul|aavin|nestle)).*(juice|\bshake\b|\blassi\b|smoothie|mojito|sandwich|omlet|omelette|burger|with (banana|ice))/, 'juicebar'],
  [/juice|frooti|maaza|\bslice\b|coke|cola|pepsi|fanta|sprite|7 ?up|bovonto|mirinda|limca|thums|\btang\b|rasna|nannari|sherbet|\bsoda\b|soft ?drink|energy drink|red ?bull|glucon|fizz|bisleri|kinley|aquafina|\bdrink\b|tropicana|\btrop\b|\breal\b|b ?natural|paper ?boat/, 'drinks'],
  [/pampers|\bpamp\b|mamy ?poko|\bmpp\b|libero|huggies|diaper|\bbaby\b|johnson|j ?son|cerelac|lactogen|nan ?pro|nestogen|wipes/, 'baby'],
  [/whisper|\bwhis\b|stayfree|sofy|\bpads?\b|pades|vicks|moov|iodex|zandu|\bbalm\b|amrutanjan|band ?aid|crocin|dolo|paracetamol|tablet|syrup|\bors\b|electral|digene|\beno\b|hajmola|sanitary|ointment|antiseptic|thermometer|bandage|vaporub/, 'pharma'],
  [/blade|razor|gillette|shav|after ?shave|vi-?john|dorco|super ?max/, 'shaving'],
  [/colgate|\bcol\b|close ?up|clup|pepsodent|\bpep\b|sensodyne|dabur ?(red|lal)|babool|meswak|vicco|oral ?-?b|tooth|mouth ?wash|listerine/, 'oral'],
  [/shampoo|conditioner|hair|parachute|\bpara\b|clinic ?plus|sunsilk|head ?& ?shoulders|\bchik\b|meera|indulekha|navratna|keo ?karpin|dabur amla|bajaj almond|henna|garnier|tresemme|\btre\b|loreal|kumarika/, 'hair'],
  [/body ?spray|\bdeo|perfume|\baxe\b|fogg|wild ?stone|park ?avenue|\bks\b|rexona|yardley|engage|denver|rose ?water|attar|\bjood\b/, 'fragrance'],
  [/soap|sopa|\blux\b|lifebuoy|santoor|cinthol|hamam|medimix|\bpears\b(?!.*\b(kg|fruit)\b)|\bdove\b|margo|mysore ?sandal|savlon|dettol|hand ?wash|body ?wash|shower|sanitizer|sanitiser|fiama|vivel|liril|talc|dream ?flower|\bpds\b|nycil|prickly|vaseline|boro ?plus|white ?tone/, 'bath'],
  [/face|fair ?& ?lovely|glow ?& ?lovely|\bfal\b|ponds|pond's|olay|himalaya|lakme|veet|\bcream\b|lip|kajal|kumkum|sindoor|eyeliner|nail|lotion|moistur|sunscreen|serum|nivea/, 'skin'],
  [/surf|\bsuf\b|ariel|\btide\b|\brin\b|wheel|ghadi|henko|detergent|washing|comfort|fabric|ujala|robin ?blue|laundry|mugi/, 'laundry'],
  [/odomos|odomas|odonil|good ?knight|all ?out|mortein|\bhit\b|mosquito|coil|repellent|room ?spray|air ?fresh|ambi ?pur|good ?air|naphthalene|cockroach/, 'fresheners'],
  [/lizol|harpic|colin|domex|phenyl|cleaner|scrub|scotch ?brite|\bvim\b|pril|\bexo\b|dish ?wash|broom|\bmop\b|toilet|bleach|sponge|steel ?wool|garbage|dustbin|mr ?muscle|wiper|duster/, 'cleaning'],
  [/agarbatti|incense|camphor|karpuram|sambrani|dhoop|vibhuti|vibuthi|candle|vilaku|\bdiya\b|wick|pooja|kovil|mangaldeep|zed ?black|\bcycle\b|devbhakti|bhajan|thiri|\bmatch/, 'pooja'],
  [/crayon|croyon|pastel|pencil|eraser|sharpener|note ?book|\btoys?\b|balloon|chalk|sketch|\bscale\b|stationery|\bpen\b|colour ?box|\bclay\b|puzzle/, 'kids'],
  [/paper ?plate|\bplates?\b|tissue|\bfoil\b|napkin|cling|zip ?lock|container/, 'disposables'],
  [/corn ?flakes|flakes|chocos|muesli|\boats\b|cereal|kellog|kellgg|granola/, 'breakfast'],
  [/chocolate|choco|dairy ?milk|\bcdm\b|\bdm\b|kit ?kat|5 ?star|\bperk\b|munch|\bsilk\b|bournville|bounty|snickers|kinder|galaxy|\bfuse\b|eclair|choclair|coclair|candy|toffee|lollipop|poppins|\bgems\b|mentos|tic ?tac|chewing|\bgum\b|center ?fresh|\bpolo\b|milky ?bar|bar ?one|sweets?\b|soan|laddu|halwa|mysore ?pak|jalebi|gulab|rasgulla|mithai|\bshots\b/, 'sweets'],
  [/biscuit|cooki|marie|oreo|bourbon|good ?day|bikis|jim ?jam|digestive|cracker|monaco|krack|50-50|parle|hide ?& ?seek|\btreat\b|cake|muffin|swiss ?roll|brownie|rusk|wafer|milano|unibic|sunfeast|\bbri\b/, 'biscuits'],
  [/chips|lays|bingo|kurkure|cheetos|pringles|act ?ii|act ?2|nachos|crisps|puffs|snack|mixture|muruk|pakoda|bhujia|namkeen|haldiram|chakli|\bsev\b|boondi|\bpori\b|time ?pass|popcorn|peanut ?roll|kamarkat|chikki|makhana/, 'munchies'],
  [/\btea\b|chai|coffee|\bbru\b|nescafe|narasu|chicory|decoction|horlicks|boost|complan|bournvita|pediasure|protinex|\bviva\b|ensure|\bmalt|health ?drink/, 'tea'],
  [/ketchup|sauce|\bjam\b|honey|peanut ?butter|spread|mayo|vinegar|pickle|thokku|achar|chutney/, 'breakfast'],
  [/noodle|\bnood|maggi|ramen|vermicelli|semiya|idiyappam|pasta|macaroni|spaghetti|soup|ready|instant|batter|\bmix\b|puttu|kichdi|appalam|papad|vadam|vathal|frozen|nuggets|fries/, 'packaged'],
  [/masala|chill?i ?powder|chilly|turmeric|haldi|jeera|cumin|mustard|\bhing\b|asafoetida|sambar|rasam|garam|dhaniya|coriander ?powder|fenugreek|cardamom|elaichi|clove|cinnamon|pepper|spice|\bpaste\b|kasuri|tamarind|\bpuli\b|bhaji|badam|almond|cashew|pista|walnut|raisin|kismis|dry ?fruit|anjeer|\bnuts?\b|\bdates?\b|saffron|kesar/, 'masala'],
  [/\brice\b|boiled|ponni|basmati|samba|atta|maida|\brava\b|sooji|semolina|flour|ragi|wheat|besan|millet|varagu|samai|thinai|kambu|\bdal\b|dhal|toor|moong|urad|\borid|chana|chenna|\bgram\b|rajma|lentil|payar|\boil\b|gingelly|sesame|idhayam|sunflower|sundrop|saffola|gold ?winner|fortune|groundnut|\bghee\b|sugar|suger|jaggery|karuppatti|vellam|\bsalt\b|poha|\baval\b|\bavul\b|karamani|sago|javvarisi/, 'staples'],
  [/milk|curd|yogh?urt|dahi|paneer|cheese|butter|aavin|heritage|amul|\beggs?\b|bread|\bbun\b|\bpav\b/, 'dairy'],
];
// ---------------------------------------------------------------- the shop's own category, when the name says nothing
const CAT_RULES = [
  [/biscuit/, 'biscuits'], [/green tea|\btea\b|coffee|horlicks|complan|boost|bournvita/, 'tea'], [/flour|atta|rice|\bdal\b|\boil\b/, 'staples'],
  [/dates|dry ?fruit|masala|spice/, 'masala'], [/shav|blade|razor/, 'shaving'], [/soap|body ?wash|hand ?wash|talc/, 'bath'], [/shampoo|hair/, 'hair'],
  [/face|cream|lip|lotion|skin/, 'skin'], [/paste|tooth|mouth|oral/, 'oral'], [/body ?spray|perfume|deo|fragrance/, 'fragrance'],
  [/baby/, 'baby'], [/medicine|pharma|tablet|health/, 'pharma'], [/washing|detergent|laundry/, 'laundry'],
  [/room ?spray|spray|freshener|mosquito|repellent/, 'fresheners'], [/clean|phenyl/, 'cleaning'], [/match|pooja|puja|agarbatti/, 'pooja'],
  [/child|toy|kid|station/, 'kids'], [/plate|disposable/, 'disposables'], [/drink|juice|beverage/, 'drinks'], [/snack/, 'munchies'],
  [/dairy|milk|bread|egg/, 'dairy'], [/sweet|chocolate/, 'sweets'],
];

function classify(name, cat) {
  const n = ` ${String(name || '').toLowerCase()} `;
  const c = String(cat || '').toLowerCase();
  if (/vegetable|\bveg|fruit|greens/.test(c)) {
    if (/\beggs?\b/.test(n)) return 'dairy';
    if (/\brice\b|boiled/.test(n)) return 'staples';
    if (/plate|\bcups?\b|tissue/.test(n)) return 'disposables';
    if (EXOTIC.test(n)) return 'exotics';
    if (FRUIT.test(n) && !NOT_FRUIT.test(n)) return 'fruits';
    return 'veg';
  }
  for (const [re, key] of NAME_RULES) if (re.test(n)) return key;
  for (const [re, key] of CAT_RULES) if (re.test(c)) return key;
  return 'packaged';
}

// ---------------------------------------------------------------- which products are in which section, kept until the products change
let cache = { v: '', of: new Map(), ids: new Map() };
async function map() {
  const v = await require('./catalog').version();
  if (v === cache.v) return cache;
  const rows = await db.query(`SELECT i.id, i.name, i.shop_section, c.name cat FROM items i LEFT JOIN categories c ON c.id=i.category_id
    WHERE i.active=1 AND i.price IS NOT NULL AND i.price > 0`);
  const of = new Map();
  const ids = new Map(SECTIONS.map((s) => [s[0], []]));
  for (const r of rows) {
    const key = KEYS.has(r.shop_section) ? r.shop_section : classify(r.name, r.cat);
    of.set(r.id, key);
    ids.get(key).push(r.id);
  }
  cache = { v, of, ids };
  return cache;
}
async function idsOf(key) { return (await map()).ids.get(key) || []; }
async function sectionOf(id) { return (await map()).of.get(id) || 'packaged'; }

// Sections with something to sell, for the shop's menus.
async function list() {
  const m = await map();
  return SECTIONS.map(([key, name, group]) => ({ key, name, group, count: (m.ids.get(key) || []).length })).filter((s) => s.count);
}

module.exports = { GROUPS, SECTIONS, KEYS, classify, idsOf, sectionOf, list, map, reset: () => { cache = { v: '', of: new Map(), ids: new Map() }; } };
