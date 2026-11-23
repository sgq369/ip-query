// qinlv-ip-query — IP 查询 Worker
// 访客 IP 用 Cloudflare request.cf（免费、无外部调用）；任意 IP 查 ip-api.com（免费免 Key，
// 失败时回退 ipinfo.io），地理数据经 Workers 缓存 24 小时。
// ASN 用 RIPEstat（免费免 Key），rDNS / 域名解析用 dns.google DoH。
// 功能：/api/lookup、/api/rdap、/api/dns-multi、/api/resolve、/api/rdns、/api/asn、/api/me。
// SEO：Top IP 落地页服务端渲染（可收录），其余 /ip/ 走 SPA + X-Robots-Tag: noindex；
// robots.txt / sitemap.xml / manifest 在 public/；统计用 Cloudflare Web Analytics（beacon）。
// 纯净度评分是本站自定透明规则（基础 100 分扣分制），非官方评分。

const IP_API_FIELDS = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query';
const JSON_HDR_SHORT = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' };
const JSON_HDR_LONG = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' };

function json(data, status = 200, maxAge = 60) {
  const headers = maxAge >= 86400 ? JSON_HDR_LONG : JSON_HDR_SHORT;
  return new Response(JSON.stringify(data), { status, headers });
}

// SEO 落地页白名单：高频公共 DNS 与知名 IP（50–100 个，只给这些做服务端渲染；其余 /ip/ 不收录）
const TOP_IPS = [
  '8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '149.112.112.112',
  '114.114.114.114', '114.114.115.115', '223.5.5.5', '223.6.6.6',
  '180.76.76.76', '119.29.29.29', '182.254.116.116', '140.205.19.6',
  '208.67.222.222', '208.67.220.220', '64.6.64.6', '64.6.65.6',
  '77.88.8.8', '77.88.8.1', '80.80.80.80', '80.80.81.81',
  '4.2.2.1', '4.2.2.2', '4.2.2.3', '4.2.2.4', '8.26.56.26',
  '84.200.69.80', '84.200.70.40', '91.239.100.100',
  '195.46.39.39', '195.46.39.40', '185.121.177.177', '185.121.177.53',
  '76.76.2.0', '76.76.10.0', '94.140.14.14', '94.140.15.15',
  '218.30.19.40', '61.139.2.69', '202.96.128.86', '202.96.128.166',
  '211.137.32.178', '221.5.88.88', '219.141.136.10', '219.141.140.10',
  '202.102.192.68', '202.102.199.68', '211.136.192.6', '221.130.33.52',
  '218.104.111.114', '202.101.172.35', '61.177.7.1', '202.98.0.68',
  '222.222.222.222', '180.168.255.18', '116.116.116.116',
  '1.2.4.8', '210.2.4.8', '101.226.4.6', '168.95.1.1',
];
function isIP(s) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[0-9a-fA-F:]+$/.test(s) && s.includes(':');
}
function isIPv4(s) { return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s); }

// 带超时的 fetch：任一上游慢也不拖垮整次查询
async function fetchJSON(url, ms = 5000, headers = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'qinlv-ip-query/2.0', ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// __CN_NAMES_BEGIN__
var CN_COUNTRY={"US":"美国","CN":"中国","TW":"台湾","HK":"香港","MO":"澳门","JP":"日本","KR":"韩国","KP":"朝鲜","SG":"新加坡","MY":"马来西亚","TH":"泰国","VN":"越南","ID":"印度尼西亚","PH":"菲律宾","IN":"印度","PK":"巴基斯坦","BD":"孟加拉国","LK":"斯里兰卡","NP":"尼泊尔","MM":"缅甸","KH":"柬埔寨","LA":"老挝","MN":"蒙古","KZ":"哈萨克斯坦","UZ":"乌兹别克斯坦","KG":"吉尔吉斯斯坦","TJ":"塔吉克斯坦","TM":"土库曼斯坦","GE":"格鲁吉亚","AM":"亚美尼亚","AZ":"阿塞拜疆","TR":"土耳其","IL":"以色列","PS":"巴勒斯坦","AE":"阿联酋","SA":"沙特阿拉伯","QA":"卡塔尔","KW":"科威特","BH":"巴林","OM":"阿曼","JO":"约旦","LB":"黎巴嫩","IQ":"伊拉克","IR":"伊朗","SY":"叙利亚","YE":"也门","AF":"阿富汗","GB":"英国","IE":"爱尔兰","FR":"法国","DE":"德国","NL":"荷兰","BE":"比利时","LU":"卢森堡","CH":"瑞士","AT":"奥地利","SE":"瑞典","NO":"挪威","DK":"丹麦","FI":"芬兰","IS":"冰岛","ES":"西班牙","PT":"葡萄牙","IT":"意大利","GR":"希腊","PL":"波兰","CZ":"捷克","SK":"斯洛伐克","HU":"匈牙利","RO":"罗马尼亚","BG":"保加利亚","HR":"克罗地亚","SI":"斯洛文尼亚","RS":"塞尔维亚","BA":"波黑","ME":"黑山","AL":"阿尔巴尼亚","MK":"北马其顿","UA":"乌克兰","RU":"俄罗斯","BY":"白俄罗斯","MD":"摩尔多瓦","EE":"爱沙尼亚","LV":"拉脱维亚","LT":"立陶宛","CY":"塞浦路斯","MT":"马耳他","AD":"安道尔","MC":"摩纳哥","LI":"列支敦士登","SM":"圣马力诺","VA":"梵蒂冈","GI":"直布罗陀","FO":"法罗群岛","GL":"格陵兰","JE":"泽西","GG":"根西","IM":"马恩岛","AX":"奥兰","EG":"埃及","ZA":"南非","NG":"尼日利亚","KE":"肯尼亚","MA":"摩洛哥","DZ":"阿尔及利亚","TN":"突尼斯","LY":"利比亚","ET":"埃塞俄比亚","GH":"加纳","CI":"科特迪瓦","SN":"塞内加尔","AO":"安哥拉","ZM":"赞比亚","ZW":"津巴布韦","MZ":"莫桑比克","MG":"马达加斯加","MU":"毛里求斯","TZ":"坦桑尼亚","UG":"乌干达","SD":"苏丹","SS":"南苏丹","SO":"索马里","CM":"喀麦隆","NA":"纳米比亚","BW":"博茨瓦纳","RW":"卢旺达","CA":"加拿大","MX":"墨西哥","BR":"巴西","AR":"阿根廷","CL":"智利","CO":"哥伦比亚","PE":"秘鲁","VE":"委内瑞拉","EC":"厄瓜多尔","UY":"乌拉圭","PY":"巴拉圭","BO":"玻利维亚","CR":"哥斯达黎加","PA":"巴拿马","CU":"古巴","DO":"多米尼加","PR":"波多黎各","JM":"牙买加","GT":"危地马拉","HN":"洪都拉斯","SV":"萨尔瓦多","NI":"尼加拉瓜","BZ":"伯利兹","BS":"巴哈马","BB":"巴巴多斯","TT":"特立尼达和多巴哥","GY":"圭亚那","SR":"苏里南","GF":"法属圭亚那","FK":"福克兰群岛","AU":"澳大利亚","NZ":"新西兰","FJ":"斐济","PG":"巴布亚新几内亚","SB":"所罗门群岛","VU":"瓦努阿图","NC":"新喀里多尼亚","PF":"法属波利尼西亚","GU":"关岛","MP":"北马里亚纳","AS":"美属萨摩亚","WS":"萨摩亚","TO":"汤加","KI":"基里巴斯","FM":"密克罗尼西亚","MH":"马绍尔群岛","PW":"帕劳","NR":"瑙鲁","TV":"图瓦卢","BT":"不丹","MV":"马尔代夫","TL":"东帝汶","BN":"文莱","RE":"留尼汪","YT":"马约特","GP":"瓜德罗普","MQ":"马提尼克","AW":"阿鲁巴","CW":"库拉索","SX":"荷属圣马丁","MF":"圣马丁","BL":"圣巴泰勒米","BM":"百慕大","KY":"开曼群岛","VG":"英属维尔京群岛","VI":"美属维尔京群岛","SH":"圣赫勒拿","CV":"佛得角","ST":"圣多美和普林西比","SC":"塞舌尔","KM":"科摩罗","DJ":"吉布提","ER":"厄立特里亚","ML":"马里","NE":"尼日尔","TD":"乍得","CF":"中非","BJ":"贝宁","TG":"多哥","SL":"塞拉利昂","LR":"利比里亚","GN":"几内亚","GW":"几内亚比绍","MR":"毛里塔尼亚","GA":"加蓬","CG":"刚果（布）","CD":"刚果（金）","BI":"布隆迪","MW":"马拉维","LS":"莱索托","SZ":"斯威士兰","GQ":"赤道几内亚","IO":"英属印度洋领地","AQ":"南极洲","BV":"布韦岛","HM":"赫德岛","GS":"南乔治亚","TF":"法属南部领地","UM":"美国本土外小岛屿","BQ":"荷属加勒比"};
var CN_COUNTRY_NAME={"united states":"美国","china":"中国","taiwan":"台湾","hong kong":"香港","macao":"澳门","japan":"日本","south korea":"韩国","north korea":"朝鲜","singapore":"新加坡","malaysia":"马来西亚","thailand":"泰国","vietnam":"越南","indonesia":"印度尼西亚","philippines":"菲律宾","india":"印度","pakistan":"巴基斯坦","bangladesh":"孟加拉国","sri lanka":"斯里兰卡","nepal":"尼泊尔","myanmar":"缅甸","cambodia":"柬埔寨","laos":"老挝","mongolia":"蒙古","kazakhstan":"哈萨克斯坦","uzbekistan":"乌兹别克斯坦","kyrgyzstan":"吉尔吉斯斯坦","tajikistan":"塔吉克斯坦","turkmenistan":"土库曼斯坦","georgia":"格鲁吉亚","armenia":"亚美尼亚","azerbaijan":"阿塞拜疆","turkey":"土耳其","turkiye":"土耳其","israel":"以色列","palestine":"巴勒斯坦","united arab emirates":"阿联酋","saudi arabia":"沙特阿拉伯","qatar":"卡塔尔","kuwait":"科威特","bahrain":"巴林","oman":"阿曼","jordan":"约旦","lebanon":"黎巴嫩","iraq":"伊拉克","iran":"伊朗","syria":"叙利亚","yemen":"也门","afghanistan":"阿富汗","united kingdom":"英国","ireland":"爱尔兰","france":"法国","germany":"德国","netherlands":"荷兰","belgium":"比利时","luxembourg":"卢森堡","switzerland":"瑞士","austria":"奥地利","sweden":"瑞典","norway":"挪威","denmark":"丹麦","finland":"芬兰","iceland":"冰岛","spain":"西班牙","portugal":"葡萄牙","italy":"意大利","greece":"希腊","poland":"波兰","czechia":"捷克","czech republic":"捷克","slovakia":"斯洛伐克","hungary":"匈牙利","romania":"罗马尼亚","bulgaria":"保加利亚","croatia":"克罗地亚","slovenia":"斯洛文尼亚","serbia":"塞尔维亚","bosnia and herzegovina":"波黑","montenegro":"黑山","albania":"阿尔巴尼亚","north macedonia":"北马其顿","ukraine":"乌克兰","russia":"俄罗斯","belarus":"白俄罗斯","moldova":"摩尔多瓦","estonia":"爱沙尼亚","latvia":"拉脱维亚","lithuania":"立陶宛","cyprus":"塞浦路斯","malta":"马耳他","andorra":"安道尔","monaco":"摩纳哥","liechtenstein":"列支敦士登","san marino":"圣马力诺","vatican city":"梵蒂冈","gibraltar":"直布罗陀","faroe islands":"法罗群岛","greenland":"格陵兰","jersey":"泽西","guernsey":"根西","isle of man":"马恩岛","aland islands":"奥兰","egypt":"埃及","south africa":"南非","nigeria":"尼日利亚","kenya":"肯尼亚","morocco":"摩洛哥","algeria":"阿尔及利亚","tunisia":"突尼斯","libya":"利比亚","ethiopia":"埃塞俄比亚","ghana":"加纳","ivory coast":"科特迪瓦","cote d'ivoire":"科特迪瓦","senegal":"塞内加尔","angola":"安哥拉","zambia":"赞比亚","津巴布韦":"津巴布韦","mozambique":"莫桑比克","madagascar":"马达加斯加","mauritius":"毛里求斯","tanzania":"坦桑尼亚","uganda":"乌干达","sudan":"苏丹","south sudan":"南苏丹","somalia":"索马里","cameroon":"喀麦隆","namibia":"纳米比亚","botswana":"博茨瓦纳","rwanda":"卢旺达","canada":"加拿大","mexico":"墨西哥","brazil":"巴西","argentina":"阿根廷","chile":"智利","colombia":"哥伦比亚","peru":"秘鲁","venezuela":"委内瑞拉","ecuador":"厄瓜多尔","uruguay":"乌拉圭","paraguay":"巴拉圭","bolivia":"玻利维亚","costa rica":"哥斯达黎加","panama":"巴拿马","cuba":"古巴","dominican republic":"多米尼加","puerto rico":"波多黎各","jamaica":"牙买加","guatemala":"危地马拉","honduras":"洪都拉斯","el salvador":"萨尔瓦多","nicaragua":"尼加拉瓜","belize":"伯利兹","bahamas":"巴哈马","barbados":"巴巴多斯","trinidad and tobago":"特立尼达和多巴哥","guyana":"圭亚那","suriname":"苏里南","french guiana":"法属圭亚那","falkland islands":"福克兰群岛","australia":"澳大利亚","new zealand":"新西兰","fiji":"斐济","papua new guinea":"巴布亚新几内亚","solomon islands":"所罗门群岛","vanuatu":"瓦努阿图","new caledonia":"新喀里多尼亚","french polynesia":"法属波利尼西亚","guam":"关岛","northern mariana islands":"北马里亚纳","american samoa":"美属萨摩亚","samoa":"萨摩亚","tonga":"汤加","kiribati":"基里巴斯","micronesia":"密克罗尼西亚","marshall islands":"马绍尔群岛","palau":"帕劳","nauru":"瑙鲁","tuvalu":"图瓦卢","bhutan":"不丹","maldives":"马尔代夫","timor-leste":"东帝汶","brunei":"文莱","reunion":"留尼汪","mayotte":"马约特","guadeloupe":"瓜德罗普","martinique":"马提尼克","aruba":"阿鲁巴","curacao":"库拉索","sint maarten":"荷属圣马丁","saint martin":"圣马丁","saint barthelemy":"圣巴泰勒米","bermuda":"百慕大","cayman islands":"开曼群岛","british virgin islands":"英属维尔京群岛","u.s. virgin islands":"美属维尔京群岛","saint helena":"圣赫勒拿","cape verde":"佛得角","sao tome and principe":"圣多美和普林西比","seychelles":"塞舌尔","comoros":"科摩罗","djibouti":"吉布提","eritrea":"厄立特里亚","mali":"马里","niger":"尼日尔","chad":"乍得","central african republic":"中非","benin":"贝宁","togo":"多哥","sierra leone":"塞拉利昂","liberia":"利比里亚","guinea":"几内亚","guinea-bissau":"几内亚比绍","mauritania":"毛里塔尼亚","gabon":"加蓬","republic of the congo":"刚果（布）","democratic republic of the congo":"刚果（金）","burundi":"布隆迪","malawi":"马拉维","lesotho":"莱索托","eswatini":"斯威士兰","swaziland":"斯威士兰","equatorial guinea":"赤道几内亚","british indian ocean territory":"英属印度洋领地","antarctica":"南极洲","bouvet island":"布韦岛","heard island and mcdonald islands":"赫德岛","south georgia and the south sandwich islands":"南乔治亚","french southern territories":"法属南部领地","united states minor outlying islands":"美国本土外小岛屿","bonaire, sint eustatius and saba":"荷属加勒比"};
var CN_COUNTRY_EN={"US":"United States","CN":"China","TW":"Taiwan","HK":"Hong Kong","MO":"Macao","JP":"Japan","KR":"South Korea","KP":"North Korea","SG":"Singapore","MY":"Malaysia","TH":"Thailand","VN":"Vietnam","ID":"Indonesia","PH":"Philippines","IN":"India","PK":"Pakistan","BD":"Bangladesh","LK":"Sri Lanka","NP":"Nepal","MM":"Myanmar","KH":"Cambodia","LA":"Laos","MN":"Mongolia","KZ":"Kazakhstan","UZ":"Uzbekistan","KG":"Kyrgyzstan","TJ":"Tajikistan","TM":"Turkmenistan","GE":"Georgia","AM":"Armenia","AZ":"Azerbaijan","TR":"Turkey","IL":"Israel","PS":"Palestine","AE":"United Arab Emirates","SA":"Saudi Arabia","QA":"Qatar","KW":"Kuwait","BH":"Bahrain","OM":"Oman","JO":"Jordan","LB":"Lebanon","IQ":"Iraq","IR":"Iran","SY":"Syria","YE":"Yemen","AF":"Afghanistan","GB":"United Kingdom","IE":"Ireland","FR":"France","DE":"Germany","NL":"Netherlands","BE":"Belgium","LU":"Luxembourg","CH":"Switzerland","AT":"Austria","SE":"Sweden","NO":"Norway","DK":"Denmark","FI":"Finland","IS":"Iceland","ES":"Spain","PT":"Portugal","IT":"Italy","GR":"Greece","PL":"Poland","CZ":"Czechia","SK":"Slovakia","HU":"Hungary","RO":"Romania","BG":"Bulgaria","HR":"Croatia","SI":"Slovenia","RS":"Serbia","BA":"Bosnia and Herzegovina","ME":"Montenegro","AL":"Albania","MK":"North Macedonia","UA":"Ukraine","RU":"Russia","BY":"Belarus","MD":"Moldova","EE":"Estonia","LV":"Latvia","LT":"Lithuania","CY":"Cyprus","MT":"Malta","AD":"Andorra","MC":"Monaco","LI":"Liechtenstein","SM":"San Marino","VA":"Vatican City","GI":"Gibraltar","FO":"Faroe Islands","GL":"Greenland","JE":"Jersey","GG":"Guernsey","IM":"Isle of Man","AX":"Aland Islands","EG":"Egypt","ZA":"South Africa","NG":"Nigeria","KE":"Kenya","MA":"Morocco","DZ":"Algeria","TN":"Tunisia","LY":"Libya","ET":"Ethiopia","GH":"Ghana","CI":"Ivory Coast","SN":"Senegal","AO":"Angola","ZM":"Zambia","ZW":"津巴布韦","MZ":"Mozambique","MG":"Madagascar","MU":"Mauritius","TZ":"Tanzania","UG":"Uganda","SD":"Sudan","SS":"South Sudan","SO":"Somalia","CM":"Cameroon","NA":"Namibia","BW":"Botswana","RW":"Rwanda","CA":"Canada","MX":"Mexico","BR":"Brazil","AR":"Argentina","CL":"Chile","CO":"Colombia","PE":"Peru","VE":"Venezuela","EC":"Ecuador","UY":"Uruguay","PY":"Paraguay","BO":"Bolivia","CR":"Costa Rica","PA":"Panama","CU":"Cuba","DO":"Dominican Republic","PR":"Puerto Rico","JM":"Jamaica","GT":"Guatemala","HN":"Honduras","SV":"El Salvador","NI":"Nicaragua","BZ":"Belize","BS":"Bahamas","BB":"Barbados","TT":"Trinidad and Tobago","GY":"Guyana","SR":"Suriname","GF":"French Guiana","FK":"Falkland Islands","AU":"Australia","NZ":"New Zealand","FJ":"Fiji","PG":"Papua New Guinea","SB":"Solomon Islands","VU":"Vanuatu","NC":"New Caledonia","PF":"French Polynesia","GU":"Guam","MP":"Northern Mariana Islands","AS":"American Samoa","WS":"Samoa","TO":"Tonga","KI":"Kiribati","FM":"Micronesia","MH":"Marshall Islands","PW":"Palau","NR":"Nauru","TV":"Tuvalu","BT":"Bhutan","MV":"Maldives","TL":"Timor-Leste","BN":"Brunei","RE":"Reunion","YT":"Mayotte","GP":"Guadeloupe","MQ":"Martinique","AW":"Aruba","CW":"Curacao","SX":"Sint Maarten","MF":"Saint Martin","BL":"Saint Barthelemy","BM":"Bermuda","KY":"Cayman Islands","VG":"British Virgin Islands","VI":"U.S. Virgin Islands","SH":"Saint Helena","CV":"Cape Verde","ST":"Sao Tome and Principe","SC":"Seychelles","KM":"Comoros","DJ":"Djibouti","ER":"Eritrea","ML":"Mali","NE":"Niger","TD":"Chad","CF":"Central African Republic","BJ":"Benin","TG":"Togo","SL":"Sierra Leone","LR":"Liberia","GN":"Guinea","GW":"Guinea-Bissau","MR":"Mauritania","GA":"Gabon","CG":"Republic of the Congo","CD":"Democratic Republic of the Congo","BI":"Burundi","MW":"Malawi","LS":"Lesotho","SZ":"Eswatini","GQ":"Equatorial Guinea","IO":"British Indian Ocean Territory","AQ":"Antarctica","BV":"Bouvet Island","HM":"Heard Island and McDonald Islands","GS":"South Georgia and the South Sandwich Islands","TF":"French Southern Territories","UM":"United States Minor Outlying Islands","BQ":"Bonaire, Sint Eustatius and Saba"};
var CN_PLACE={"california":"加利福尼亚","texas":"得克萨斯","florida":"佛罗里达","washington":"华盛顿","oregon":"俄勒冈","nevada":"内华达","arizona":"亚利桑那","utah":"犹他","colorado":"科罗拉多","new mexico":"新墨西哥","idaho":"爱达荷","montana":"蒙大拿","wyoming":"怀俄明","north dakota":"北达科他","south dakota":"南达科他","nebraska":"内布拉斯加","kansas":"堪萨斯","oklahoma":"俄克拉荷马","missouri":"密苏里","iowa":"爱荷华","minnesota":"明尼苏达","wisconsin":"威斯康星","michigan":"密歇根","illinois":"伊利诺伊","indiana":"印第安纳","ohio":"俄亥俄","kentucky":"肯塔基","tennessee":"田纳西","alabama":"阿拉巴马","georgia":"佐治亚","south carolina":"南卡罗来纳","north carolina":"北卡罗来纳","virginia":"弗吉尼亚","west virginia":"西弗吉尼亚","maryland":"马里兰","delaware":"特拉华","new jersey":"新泽西","pennsylvania":"宾夕法尼亚","connecticut":"康涅狄格","rhode island":"罗得岛","massachusetts":"马萨诸塞","vermont":"佛蒙特","new hampshire":"新罕布什尔","maine":"缅因","alaska":"阿拉斯加","hawaii":"夏威夷","district of columbia":"华盛顿特区","mountain view":"山景城","san francisco":"旧金山","san jose":"圣何塞","los angeles":"洛杉矶","san diego":"圣迭戈","sacramento":"萨克拉门托","palo alto":"帕洛阿尔托","sunnyvale":"桑尼维尔","cupertino":"库比蒂诺","menlo park":"门洛帕克","redwood city":"红木城","fremont":"弗里蒙特","oakland":"奥克兰","berkeley":"伯克利","santa clara":"圣克拉拉","santa cruz":"圣克鲁斯","san mateo":"圣马特奥","hayward":"海沃德","ashburn":"阿什本","reston":"雷斯顿","herndon":"赫恩登","chicago":"芝加哥","new york":"纽约","seattle":"西雅图","dallas":"达拉斯","houston":"休斯敦","austin":"奥斯汀","atlanta":"亚特兰大","miami":"迈阿密","boston":"波士顿","denver":"丹佛","phoenix":"菲尼克斯","las vegas":"拉斯维加斯","portland":"波特兰","salt lake city":"盐湖城","nashville":"纳什维尔","minneapolis":"明尼阿波利斯","detroit":"底特律","cleveland":"克利夫兰","pittsburgh":"匹兹堡","philadelphia":"费城","baltimore":"巴尔的摩","st. louis":"圣路易斯","kansas city":"堪萨斯城","new orleans":"新奥尔良","memphis":"孟菲斯","charlotte":"夏洛特","raleigh":"罗利","columbus":"哥伦布","cincinnati":"辛辛那提","indianapolis":"印第安纳波利斯","milwaukee":"密尔沃基","albuquerque":"阿尔伯克基","tucson":"图森","honolulu":"檀香山","anchorage":"安克雷奇","flower mound":"花丘","plano":"普莱诺","frisco":"弗里斯科","irving":"欧文","arlington":"阿灵顿","fort worth":"沃思堡","denton":"丹顿","richardson":"理查森","garland":"加兰","mesquite":"梅斯基特","carrollton":"卡罗尔顿","lewisville":"刘易斯维尔","allen":"艾伦","mckinney":"麦金尼","benicia":"贝尼西亚","fairfield":"费尔菲尔德","vallejo":"瓦列霍","petaluma":"佩塔卢马","american canyon":"美国峡谷","point reyes national seashore":"雷耶斯角国家海岸","santa rosa":"圣罗莎","napa":"纳帕","concord":"康科德","san rafael":"圣拉斐尔","novato":"诺瓦托","martinez":"马丁内斯","littleton":"利特尔顿","aurora":"奥罗拉","lakewood":"莱克伍德","arvada":"阿瓦达","westminster":"威斯敏斯特","thornton":"桑顿","centennial":"森特尼尔","boulder":"博尔德","fort collins":"柯林斯堡","colorado springs":"科罗拉多斯普林斯","pueblo":"普韦布洛","greeley":"格里利","longmont":"朗蒙特","loveland":"拉夫兰","grand junction":"大章克申","aspen":"阿斯彭","vail":"韦尔","durango":"杜兰戈","san antonio":"圣安东尼奥","el paso":"埃尔帕索","oklahoma city":"俄克拉荷马城","tulsa":"塔尔萨","wichita":"威奇托","omaha":"奥马哈","lincoln":"林肯","des moines":"得梅因","fargo":"法戈","sioux falls":"苏福尔斯","boise":"博伊西","reno":"里诺","spokane":"斯波坎","tacoma":"塔科马","eugene":"尤金","salem":"塞勒姆","bend":"本德","medford":"梅德福","juneau":"朱诺","fairbanks":"费尔班克斯","billings":"比林斯","missoula":"米苏拉","cheyenne":"夏延","casper":"卡斯珀","santa fe":"圣菲","flagstaff":"弗拉格斯塔夫","mesa":"梅萨","scottsdale":"斯科茨代尔","chandler":"钱德勒","glendale":"格伦代尔","henderson":"亨德森","north las vegas":"北拉斯维加斯","ogden":"奥格登","provo":"普罗沃","sandy":"桑迪","orem":"奥勒姆","layton":"莱顿","logan":"洛根","st. george":"圣乔治","idaho falls":"爱达荷福尔斯","nampa":"南帕","meridian":"梅里迪安","pocatello":"波卡特洛","twin falls":"双子瀑布","tokyo":"东京","osaka":"大阪","nagoya":"名古屋","kyoto":"京都","yokohama":"横滨","kobe":"神户","fukuoka":"福冈","sapporo":"札幌","sendai":"仙台","hiroshima":"广岛","nara":"奈良","kanagawa":"神奈川","chiba":"千叶","saitama":"埼玉","aichi":"爱知","hyogo":"兵库","hokkaido":"北海道","seoul":"首尔","busan":"釜山","incheon":"仁川","daegu":"大邱","daejeon":"大田","gwangju":"光州","ulsan":"蔚山","suwon":"水原","gyeonggi":"京畿","pyongyang":"平壤","beijing":"北京","shanghai":"上海","guangzhou":"广州","shenzhen":"深圳","chengdu":"成都","chongqing":"重庆","wuhan":"武汉","xi'an":"西安","hangzhou":"杭州","nanjing":"南京","tianjin":"天津","suzhou":"苏州","zhengzhou":"郑州","changsha":"长沙","qingdao":"青岛","dalian":"大连","xiamen":"厦门","fuzhou":"福州","harbin":"哈尔滨","changchun":"长春","shenyang":"沈阳","jinan":"济南","hefei":"合肥","kunming":"昆明","guiyang":"贵阳","nanning":"南宁","haikou":"海口","lanzhou":"兰州","xining":"西宁","yinchuan":"银川","hohhot":"呼和浩特","urumqi":"乌鲁木齐","lhasa":"拉萨","taipei":"台北","kaohsiung":"高雄","taichung":"台中","tainan":"台南","hong kong":"香港","macau":"澳门","guangdong":"广东","zhejiang":"浙江","jiangsu":"江苏","fujian":"福建","shandong":"山东","sichuan":"四川","hubei":"湖北","hunan":"湖南","henan":"河南","hebei":"河北","shanxi":"山西","shaanxi":"陕西","liaoning":"辽宁","jilin":"吉林","heilongjiang":"黑龙江","anhui":"安徽","jiangxi":"江西","yunnan":"云南","guizhou":"贵州","guangxi":"广西","hainan":"海南","gansu":"甘肃","qinghai":"青海","ningxia":"宁夏","xinjiang":"新疆","inner mongolia":"内蒙古","tibet":"西藏","nanchang":"南昌","dongguan":"东莞","foshan":"佛山","wuxi":"无锡","ningbo":"宁波","wenzhou":"温州","changzhou":"常州","nantong":"南通","yangzhou":"扬州","xuzhou":"徐州","yantai":"烟台","weifang":"潍坊","luoyang":"洛阳","baoding":"保定","tangshan":"唐山","huizhou":"惠州","zhuhai":"珠海","shantou":"汕头","new taipei":"新北","taoyuan":"桃园","hsinchu":"新竹","keelung":"基隆","chiayi":"嘉义","kowloon":"九龙","new territories":"新界","singapore":"新加坡","kuala lumpur":"吉隆坡","bangkok":"曼谷","jakarta":"雅加达","manila":"马尼拉","hanoi":"河内","ho chi minh city":"胡志明市","new delhi":"新德里","delhi":"德里","mumbai":"孟买","bangalore":"班加罗尔","bengaluru":"班加罗尔","karachi":"卡拉奇","islamabad":"伊斯兰堡","dhaka":"达卡","colombo":"科伦坡","kathmandu":"加德满都","yangon":"仰光","phnom penh":"金边","vientiane":"万象","bandung":"万隆","surabaya":"泗水","cebu":"宿务","chiang mai":"清迈","pattaya":"芭提雅","penang":"槟城","johor bahru":"新山","london":"伦敦","paris":"巴黎","berlin":"柏林","madrid":"马德里","rome":"罗马","amsterdam":"阿姆斯特丹","brussels":"布鲁塞尔","vienna":"维也纳","zurich":"苏黎世","geneva":"日内瓦","stockholm":"斯德哥尔摩","oslo":"奥斯陆","copenhagen":"哥本哈根","helsinki":"赫尔辛基","dublin":"都柏林","lisbon":"里斯本","athens":"雅典","warsaw":"华沙","prague":"布拉格","budapest":"布达佩斯","moscow":"莫斯科","istanbul":"伊斯坦布尔","ankara":"安卡拉","frankfurt":"法兰克福","frankfurt am main":"法兰克福","munich":"慕尼黑","hamburg":"汉堡","cologne":"科隆","stuttgart":"斯图加特","dusseldorf":"杜塞尔多夫","leipzig":"莱比锡","lyon":"里昂","marseille":"马赛","nice":"尼斯","toulouse":"图卢兹","bordeaux":"波尔多","nantes":"南特","manchester":"曼彻斯特","birmingham":"伯明翰","leeds":"利兹","glasgow":"格拉斯哥","edinburgh":"爱丁堡","liverpool":"利物浦","bristol":"布里斯托","milan":"米兰","naples":"那不勒斯","turin":"都灵","venice":"威尼斯","florence":"佛罗伦萨","barcelona":"巴塞罗那","valencia":"瓦伦西亚","seville":"塞维利亚","bilbao":"毕尔巴鄂","malaga":"马拉加","porto":"波尔图","krakow":"克拉科夫","gdansk":"格但斯克","rotterdam":"鹿特丹","the hague":"海牙","utrecht":"乌得勒支","antwerp":"安特卫普","zagreb":"萨格勒布","belgrade":"贝尔格莱德","sofia":"索菲亚","bucharest":"布加勒斯特","kyiv":"基辅","kiev":"基辅","minsk":"明斯克","tbilisi":"第比利斯","yerevan":"埃里温","baku":"巴库","almaty":"阿拉木图","tashkent":"塔什干","england":"英格兰","scotland":"苏格兰","wales":"威尔士","bavaria":"巴伐利亚","north rhine-westphalia":"北莱茵-威斯特法伦","baden-wurttemberg":"巴登-符腾堡","hesse":"黑森","ile-de-france":"法兰西岛","catalonia":"加泰罗尼亚","andalusia":"安达卢西亚","lombardy":"伦巴第","dubai":"迪拜","abu dhabi":"阿布扎比","doha":"多哈","riyadh":"利雅得","jeddah":"吉达","tel aviv":"特拉维夫","jerusalem":"耶路撒冷","cairo":"开罗","lagos":"拉各斯","nairobi":"内罗毕","johannesburg":"约翰内斯堡","cape town":"开普敦","casablanca":"卡萨布兰卡","toronto":"多伦多","vancouver":"温哥华","montreal":"蒙特利尔","ottawa":"渥太华","calgary":"卡尔加里","edmonton":"埃德蒙顿","ontario":"安大略","quebec":"魁北克","british columbia":"不列颠哥伦比亚","alberta":"艾伯塔","manitoba":"马尼托巴","saskatchewan":"萨斯喀彻温","nova scotia":"新斯科舍","new brunswick":"新不伦瑞克","mexico city":"墨西哥城","guadalajara":"瓜达拉哈拉","sao paulo":"圣保罗","rio de janeiro":"里约热内卢","buenos aires":"布宜诺斯艾利斯","santiago":"圣地亚哥","lima":"利马","bogota":"波哥大","sydney":"悉尼","melbourne":"墨尔本","brisbane":"布里斯班","perth":"珀斯","adelaide":"阿德莱德","canberra":"堪培拉","auckland":"奥克兰","wellington":"惠灵顿","christchurch":"基督城","hamilton":"汉密尔顿","new south wales":"新南威尔士","victoria":"维多利亚","queensland":"昆士兰","western australia":"西澳大利亚","south australia":"南澳大利亚","tasmania":"塔斯马尼亚"};
var CN_ORG=[["alibaba cloud","阿里云"],["alibaba","阿里巴巴"],["tencent cloud","腾讯云"],["tencent","腾讯"],["baidu","百度"],["huawei cloud","华为云"],["huawei","华为"],["jd cloud","京东云"],["jingdong","京东"],["jd.com","京东"],["bytedance","字节跳动"],["xiaomi","小米"],["meituan","美团"],["pinduoduo","拼多多"],["netease","网易"],["sina","新浪"],["ucloud","优刻得"],["qingcloud","青云"],["kingsoft","金山云"],["google","谷歌"],["oracle","甲骨文"],["amazon","亚马逊"],["microsoft","微软"],["apple","苹果"],["samsung","三星"],["intel","英特尔"],["cisco","思科"],["dell","戴尔"],["hewlett","惠普"],["hp inc","惠普"],["lenovo","联想"],["asus","华硕"],["acer","宏碁"],["zte","中兴"],["h3c","新华三"],["china telecom","中国电信"],["chinanet","中国电信"],["china unicom","中国联通"],["china mobile","中国移动"],["china education","中国教育网"],["cernet","中国教育网"],["china science","中国科技网"],["cstnet","中国科技网"],["great wall broadband","长城宽带"],["dr. peng","鹏博士"],["wasu","华数"],["pccw","电讯盈科"],["chunghwa","中华电信"],["hinet","中华电信"],["softbank","软银"],["rakuten","乐天"],["yahoo japan","雅虎日本"],["yahoo","雅虎"],["korea telecom","韩国电信"],["kt corporation","韩国电信"],["sk broadband","SK宽带"],["singtel","新加坡电信"],["starhub","星和"],["deutsche telekom","德国电信"],["vodafone","沃达丰"],["telefonica","西班牙电信"],["british telecommunications","英国电信"],["bt group","英国电信"],["bell canada","加拿大贝尔"],["level 3","Lumen"],["meta platforms","Meta"]];
function cnCountry(code,name){var c=String(code||'').toUpperCase();if(CN_COUNTRY[c])return CN_COUNTRY[c];return cnCountryName(name);}
function cnCountryName(name){if(!name)return '';var n=String(name).toLowerCase().trim();return CN_COUNTRY_NAME[n]||name;}
function cnPlace(name){if(!name)return '';var n=String(name).toLowerCase().trim();return CN_PLACE[n]||name;}
function cnOrg(s){if(!s)return '';var v=String(s).replace(/^AS\d+\s+/i,'').trim();var l=v.toLowerCase();for(var i=0;i<CN_ORG.length;i++){if(l.indexOf(CN_ORG[i][0])>=0)return CN_ORG[i][1];}return v;}
function cnGeo(d){return {country:cnCountry(d.countryCode,d.country),region:cnPlace(d.region),city:cnPlace(d.city),isp:cnOrg(d.isp),org:cnOrg(d.org)};}
function withCn(d){var g=cnGeo(d);var cc=String(d.countryCode||'').toUpperCase();return {countryCn:g.country,countryEn:(CN_COUNTRY_EN[cc]||d.country),regionCn:g.region,cityCn:g.city,ispCn:g.isp,orgCn:g.org};}
// __CN_NAMES_END__
function normalizeIpApi(d) {
  var o = {
    source: 'ip-api.com', ip: d.query, country: d.country || '', countryCode: d.countryCode || '',
    region: d.regionName || d.region || '', city: d.city || '', zip: d.zip || '',
    lat: d.lat ?? null, lon: d.lon ?? null, timezone: d.timezone || '',
    isp: d.isp || '', org: d.org || '', as: d.as || '', asname: d.asname || '',
    mobile: !!d.mobile, proxy: !!d.proxy, hosting: !!d.hosting,
  };
  return Object.assign(o, withCn(o));
}

async function fetchIpApi(ip) {
  const d = await fetchJSON(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}`);
  if (d.status !== 'success') throw new Error(d.message || 'ip-api 查询失败');
  return normalizeIpApi(d);
}

async function fetchIpinfo(ip) {
  const d = await fetchJSON(`https://ipinfo.io/${encodeURIComponent(ip)}/json`);
  if (!d.ip) throw new Error('ipinfo 无数据');
  const [lat, lon] = String(d.loc || ',').split(',').map(Number);
  const orgParts = String(d.org || '').match(/^(AS\d+)\s+(.*)$/);
  // ipinfo 的 org 带 "AS15169 " 前缀，显示时去掉，只留组织名
  var o = { source: 'ipinfo.io', ip: d.ip, country: d.country || '', countryCode: d.country || '', region: d.region || '', city: d.city || '', zip: d.postal || '', lat: lat || null, lon: lon || null, timezone: d.timezone || '', isp: orgParts ? orgParts[2] : (d.org || ''), org: orgParts ? orgParts[2] : (d.org || ''), as: orgParts ? orgParts[1] : '', asname: orgParts ? orgParts[2] : '', mobile: false, proxy: false, hosting: false };
  return Object.assign(o, withCn(o));
}

async function lookupIP(ip) {
  try { return await fetchIpApi(ip); }
  catch (e) { /* fall through to ipinfo */ }
  try { return await fetchIpinfo(ip); }
  catch (e) {}
  return { error: 'lookup_failed', message: '上游查询失败，请稍候再试' };
}

// 地理数据 24 小时缓存（ip-api / ipinfo 的归属地一年都不怎么变）
async function cachedLookup(ip, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://lookup.qinlv/v2/${ip}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const data = await lookupIP(ip);
  if (data.error) return data;
  ctx.waitUntil(cache.put(cacheKey, json(data, 200, 86400).clone()));
  return data;
}

// ---- SSR 落地页 ----
function flagEmoji(cc) {
  cc = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const IDC_ORGS = ['google', 'cloudflare', 'amazon', 'microsoft', 'oracle', 'alibaba', 'tencent', 'cloud', 'hosting', 'cdn', 'vultr', 'linode', 'digitalocean', 'hetzner', 'ovh', 'datacenter', 'data center'];
function isIdcOrg(org) {
  const o = String(org || '').toLowerCase();
  return IDC_ORGS.some(k => o.includes(k));
}
function purityColor(s) {
  return s >= 90 ? '#34D399' : s >= 70 ? '#A3E635' : s >= 50 ? '#FBBF24' : s >= 30 ? '#FB923C' : '#F87171';
}
function purityDots(s, col) {
  const n = s >= 90 ? 5 : s >= 70 ? 4 : s >= 50 ? 3 : s >= 30 ? 2 : 1;
  let h = '';
  for (let i = 1; i <= 5; i++) h += '<span style="color:' + (i <= n ? col : 'var(--muted)') + ';opacity:' + (i <= n ? 1 : .35) + '">●</span>';
  return h;
}
function ssrPurity(d, T) {
  let score = 100;
  const rows = [];
  if (d.proxy) { score -= 40; rows.push([T.dedProxy[0], '-40', T.dedProxy[1]]); }
  if (d.hosting) { score -= 40; rows.push([T.dedHosting[0], '-40', T.dedHosting[1]]); }
  else if (isIdcOrg(d.org || d.asname)) { score -= 25; rows.push([T.dedIdc[0], '-25', T.dedIdc[1]]); }
  const grade = T.grade(score);
  return { score, grade, rows };
}
// SSR 落地页文案（zh 默认，?lang=en 时首屏即英文，不闪中文）
const SSR_TXT = {
  zh: { htmlLang: 'zh-CN', titleSuffix: '钦律亲为 IP 查询', titleWord: '归属地查询',
    badgeProxy: '代理 IP', badgeIdc: 'IDC 机房 IP', badgeMobile: '移动网络', badgeHome: '普通宽带 / 家庭宽带',
    ipAddr: 'IP 地址', ipLoc: 'IP 位置', country: '国家 / 代码', asn: 'ASN', asnHolder: 'ASN 所有者', company: '企业', lat: '经度', lon: '纬度', tz: '时区', ipType: 'IP 类型', purity: '纯净度', host: '主机名', src: '数据来源',
    viewMap: '在 OpenStreetMap 上查看 →',
    purityNote: '本站自定规则，仅供参考，非官方评分。基础 100 分，按下列信号扣分。', noDed: '无扣分项',
    desc: (ip, loc, isp, as, tz) => `${ip} 归属地：${loc}，运营商 ${isp}，${as}，时区 ${tz}。免费查询 IP 归属地、ASN、纯净度评分。`,
    grade: s => s >= 90 ? '优秀' : s >= 70 ? '良好' : s >= 50 ? '一般' : s >= 30 ? '较差' : '高风险',
    dedProxy: ['代理 IP', '该 IP 被识别为代理出口。'], dedHosting: ['托管 / 机房 IP', '该 IP 属于托管或机房网段，非家庭宽带。'], dedIdc: ['机房组织', '所属组织为云厂商或机房运营商。'] },
  en: { htmlLang: 'en', titleSuffix: 'Qinlv IP Lookup', titleWord: 'IP Lookup',
    badgeProxy: 'Proxy IP', badgeIdc: 'Datacenter IP', badgeMobile: 'Mobile network', badgeHome: 'Residential / Broadband',
    ipAddr: 'IP address', ipLoc: 'IP location', country: 'Country / Code', asn: 'ASN', asnHolder: 'ASN holder', company: 'Company', lat: 'Longitude', lon: 'Latitude', tz: 'Timezone', ipType: 'IP type', purity: 'Purity', host: 'Hostname', src: 'Source',
    viewMap: 'View on OpenStreetMap →',
    purityNote: 'Our own transparent rule, for reference only — not an official score. Starts at 100, deductions below.', noDed: 'No deductions',
    desc: (ip, loc, isp, as, tz) => `${ip} location: ${loc}, ISP ${isp}, ${as}, timezone ${tz}. Free IP lookup: location, ASN, purity score.`,
    grade: s => s >= 90 ? 'Excellent' : s >= 70 ? 'Good' : s >= 50 ? 'Fair' : s >= 30 ? 'Poor' : 'High risk',
    dedProxy: ['Proxy IP', 'This IP is identified as a proxy exit.'], dedHosting: ['Hosting / datacenter IP', 'This IP belongs to a hosting or datacenter range, not residential broadband.'], dedIdc: ['Datacenter organization', 'The owning organization is a cloud or datacenter operator.'] },
};
function ptrName(ip) {
  if (isIPv4(ip)) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  const [head, tail] = ip.split('::');
  const h = (head ? head.split(':') : []).filter(Boolean);
  const t = (tail ? tail.split(':') : []).filter(Boolean);
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(g => g.padStart(4, '0')).join('');
  if (full.length !== 32) return '';
  return `${full.split('').reverse().join('.')}.ip6.arpa`;
}
function notFoundPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>页面不存在 · 钦律亲为 IP 查询</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:48px 20px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#94A3B8;margin:0 0 24px}form{display:flex;gap:8px;max-width:520px;margin:0 auto 24px}input{flex:1;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#1E293B;color:#E2E8F0;font-size:15px}button{padding:12px 20px;border-radius:10px;border:0;background:#0D9488;color:#fff;font-size:15px;cursor:pointer}a{color:#14B8A6;text-decoration:none}</style></head><body><h1>404 · 这个页面不存在</h1><p>你可以直接查一个 IP、域名或 ASN：</p><form onsubmit="var q=document.getElementById('q').value.trim();if(q)location.href='/ip/'+encodeURIComponent(q);return false;"><input id="q" placeholder="输入 IP、域名或 ASN，例如 8.8.8.8"><button type="submit">查询</button></form><p><a href="/">← 返回钦律亲为 IP 查询首页</a></p></body></html>`;
}
async function renderLanding(request, env, ctx, ip) {
  const lang = new URL(request.url).searchParams.get('lang') === 'en' ? 'en' : 'zh';
  const T = SSR_TXT[lang];
  const cache = caches.default;
  const cacheKey = new Request(`https://ssr.qinlv/v5/${lang}/ip/${ip}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const data = await cachedLookup(ip, ctx);
  if (data.error) return null; // 上游失败时回落到 SPA，不出坏页
  let host = '';
  try {
    const name = ptrName(ip);
    if (name) {
      const r = await fetch(`https://dns.google/resolve?name=${name}&type=PTR`, { signal: AbortSignal.timeout(4000) });
      const d = await r.json();
      host = (d.Answer || [])[0]?.data?.replace(/\.$/, '') || '';
    }
  } catch (e) {}
  const base = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  let html = await base.text();
  const locZh = [data.countryCn || data.country, data.regionCn || data.region, data.cityCn || data.city].filter(Boolean).join(' ');
  const locEn = [data.countryEn || data.country, data.region, data.city].filter(Boolean).join(' ');
  const loc = lang === 'en' ? locEn : locZh;
  const ispZh = data.ispCn || data.isp || data.orgCn || data.org || '';
  const ispEn = data.isp || data.org || '';
  const isp = lang === 'en' ? ispEn : ispZh;
  const title = `${ip} ${T.titleWord} | ${loc}${isp ? ' ' + isp : ''} · ${T.titleSuffix}`;
  const desc = T.desc(ip, loc, isp, data.as || '', data.timezone || '');
  const p = ssrPurity(data, T);
  const cc = data.countryCode ? data.countryCode.toUpperCase() : '';
  const cname = lang === 'en' ? (data.countryEn || data.country || '') : (data.countryCn || data.country || '');
  // 国家名与代码相同时只显示一次（修 "US (US)"）
  const countryCell = cname ? (cc && cname.toUpperCase() !== cc ? cname + ' (' + cc + ')' : cname) : '—';
  const orgName = lang === 'en' ? (data.org || '') : (data.orgCn || data.org || '');
  const flag = flagEmoji(data.countryCode);
  const locRow = (flag ? flag + ' ' : '') + loc + (isp ? ' — ' + isp : '');
  const isIdc = data.hosting || isIdcOrg(data.org || data.asname);
  const typeCls = (data.proxy || isIdc) ? 'hot' : (data.mobile ? '' : 'ok');
  const typeLabel = data.proxy ? T.badgeProxy : isIdc ? T.badgeIdc : data.mobile ? T.badgeMobile : T.badgeHome;
  const typePill = `<span class="badge${typeCls ? ' ' + typeCls : ''}">${escHtml(typeLabel)}</span>`;
  const pcol = purityColor(p.score);
  const purityCell = `<div style="font-size:22px;font-weight:800;color:${pcol}">${p.score}<span style="font-size:13px;color:var(--muted)"> / 100 · ${escHtml(p.grade)}</span></div><div class="pbar"><div class="pfill" style="width:${p.score}%;background:${pcol}"></div></div><div style="margin:8px 0 2px;font-size:15px;letter-spacing:6px">${purityDots(p.score, pcol)}</div>`;
  const rows = [
    [T.ipAddr, `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700">${escHtml(ip)}</span> ${typePill}`],
    [T.ipLoc, escHtml(locRow || '—')],
    [T.country, escHtml(countryCell)],
    [T.asn, escHtml(data.as || '—')],
    [T.asnHolder, escHtml(data.asname || '—')],
    [T.company, escHtml(orgName || '—')],
    [T.lat, escHtml(data.lon != null ? String(data.lon) : '—')],
    [T.lon, escHtml(data.lat != null ? String(data.lat) : '—')],
    [T.tz, escHtml(data.timezone || '—')],
    [T.ipType, typePill],
    [T.purity, purityCell],
    [T.host, escHtml(host || '—')],
    [T.src, escHtml(data.source || '—')],
  ].map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${v}</td></tr>`).join('');
  const mapLink = (data.lat != null && data.lon != null)
    ? `<p><a href="https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lon}#map=10/${data.lat}/${data.lon}">${escHtml(T.viewMap)}</a></p>` : '';
  const purityRows = p.rows.map(([label, pts, ex]) => `<tr><td>${escHtml(label)}<br><span class="muted" style="font-size:12px">${escHtml(ex)}</span></td><td>${escHtml(pts)}</td></tr>`).join('')
    || `<tr><td>${escHtml(T.noDed)}</td><td>0</td></tr>`;
  const card = `<div class="card"><table class="kv">${rows}</table><p class="muted" style="margin:10px 0 0">${escHtml(T.purityNote)}</p><table class="kv">${purityRows}</table>${mapLink}</div>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebPage',
    name: `${ip} ${T.titleWord}`, description: desc,
    url: `https://ip.sungongqin.com/ip/${ip}`,
    about: { '@type': 'Place', name: loc, address: { '@type': 'PostalAddress', addressCountry: data.countryCode || '', addressLocality: data.city || '' } },
  };
  html = html.replace(/<html lang="[^"]*">/, `<html lang="${T.htmlLang}">`);
  html = html.replace(/<title>.*?<\/title>/, `<title>${escHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(desc)}">`);
  html = html.replace('<link rel="canonical" href="https://ip.sungongqin.com/">', `<link rel="canonical" href="https://ip.sungongqin.com/ip/${ip}">`);
  html = html.replace('<link rel="alternate" hreflang="zh-CN" href="https://ip.sungongqin.com/">', `<link rel="alternate" hreflang="zh-CN" href="https://ip.sungongqin.com/ip/${ip}">`);
  html = html.replace('<link rel="alternate" hreflang="en" href="https://ip.sungongqin.com/?lang=en">', `<link rel="alternate" hreflang="en" href="https://ip.sungongqin.com/ip/${ip}?lang=en">`);
  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escHtml(title)}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escHtml(desc)}">`);
  html = html.replace('<meta property="og:url" content="https://ip.sungongqin.com/">', `<meta property="og:url" content="https://ip.sungongqin.com/ip/${ip}">`);
  html = html.replace(/<script type="application\/ld\+json" id="ldjson">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="ldjson">${JSON.stringify(ld)}</script>`);
  html = html.replace('<div id="result"></div>', `<div id="result">${card}</div>`);
  // SSR 只发给浏览器 max-age=0：浏览器每次重新验证，不再把旧版 SSR 存一小时
  const res = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=86400' } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ---- RDAP ----
function vcardValue(vcard, field) {
  if (!Array.isArray(vcard)) return '';
  const props = vcard[1] || [];
  const hit = props.find(p => p[0] === field);
  return hit ? hit[3] : '';
}
function vcardEmail(vcard) {
  const v = vcardValue(vcard, 'email');
  return String(v || '').replace(/^mailto:/, '');
}
function normalizeRdap(query, type, d) {
  const entities = (d.entities || []).map(e => ({
    roles: e.roles || [],
    name: vcardValue(e.vCardArray, 'fn'),
    email: vcardEmail(e.vCardArray),
    handle: e.handle || '',
  }));
  const events = (d.events || []).map(e => ({ action: e.eventAction || '', date: e.eventDate || '' }));
  const reg = events.find(e => e.action === 'registration');
  const changed = events.find(e => e.action === 'last changed');
  const abuse = entities.find(e => (e.roles || []).includes('abuse'));
  const registrant = entities.find(e => (e.roles || []).includes('registrant'));
  const cidrs = (d.cidr0_cidrs || []).map(c => c.v4prefix ? `${c.v4prefix}/${c.length}` : (c.v6prefix ? `${c.v6prefix}/${c.length}` : '')).filter(Boolean);
  return {
    query, type, source: 'rdap.org', objectClassName: d.objectClassName || '',
    handle: d.handle || '', name: d.name || registrant?.name || '',
    startAddress: d.startAddress || '', endAddress: d.endAddress || '',
    ipVersion: d.ipVersion || '', status: d.status || [],
    registration: reg?.date || '', lastChanged: changed?.date || '',
    entities, abuseEmail: abuse?.email || '',
    cidrs, port43: d.port43 || '',
    remarks: (d.remarks || []).flatMap(r => r.description || []),
  };
}

// RDAP 兜底：rdap.org 跳转到的 ARIN 端点常对 Worker 共享出口限流（8.8.8.8 通一次后
// 就 429/失败，而 APNIC 段的 1.1.1.1 正常），失败时直接并行问五大 RIR 的 RDAP 端点，
// 取第一个成功的结果；域名只能走 rdap.org（注册商无法从域名推断）。
const RIR_RDAP = [
  'https://rdap.arin.net/registry', 'https://rdap.db.ripe.net',
  'https://rdap.apnic.net', 'https://rdap.lacnic.net/rdap',
  'https://rdap.afrinic.net/rdap',
];
async function fetchRdap(rdapUrl, type, q) {
  try { return await fetchJSON(rdapUrl, 8000); }
  catch (e) {
    if (type === 'domain') throw e;
    const kind = type === 'autnum' ? 'autnum' : 'ip';
    const tried = await Promise.allSettled(
      RIR_RDAP.map(base => fetchJSON(`${base}/${kind}/${encodeURIComponent(q)}`, 8000))
    );
    const good = tried.find(t => t.status === 'fulfilled' && t.value && t.value.objectClassName);
    if (good) return good.value;
    throw e;
  }
}
function dohAnswers(d) {
  return (d.Answer || []).filter(a => a.data).map(a => String(a.data).replace(/\.$/, ''));
}
async function dohQuery(name, type, provider) {
  const enc = encodeURIComponent(name);
  try {
    if (provider === 'google') {
      const d = await fetchJSON(`https://dns.google/resolve?name=${enc}&type=${type}`);
      return dohAnswers(d);
    }
    if (provider === 'cloudflare') {
      const d = await fetchJSON(`https://cloudflare-dns.com/dns-query?name=${enc}&type=${type}`, 5000, { accept: 'application/dns-json' });
      return dohAnswers(d);
    }
    if (provider === 'alidns') {
      const d = await fetchJSON(`https://dns.alidns.com/resolve?name=${enc}&type=${type === 'A' ? 1 : type === 'AAAA' ? 28 : 12}`);
      return dohAnswers(d);
    }
    if (provider === 'dohpub') {
      const d = await fetchJSON(`https://doh.pub/dns-query?name=${enc}&type=${type}`, 5000, { accept: 'application/dns-json' });
      return dohAnswers(d);
    }
  } catch (e) { return null; }
  return null;
}
const DOH_PROVIDERS = [
  ['google', 'Google DNS'], ['cloudflare', 'Cloudflare 1.1.1.1'],
  ['alidns', '阿里 DNS'], ['dohpub', 'DNSPod'],
];


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const cf = request.cf || {};

    // 纯文本接口（ping0 式）：curl 直接拿 IP
    if (path === '/ipv4' || path === '/ipv6') {
      const want6 = path === '/ipv6';
      const ok = want6 ? ip.includes(':') : !ip.includes(':');
      return new Response(ok ? ip + '\n' : '', { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
    }
    // 根路径始终返回页面；纯文本 IP 用 /ipv4、/ipv6、/geo（UA 检测经代理后不可靠，不依赖它）
    if (path === '/geo') {
      const me = { ip, country: cf.country, city: cf.city, asn: cf.asn, org: cf.asOrganization };
      if (url.searchParams.get('format') === 'json') return json(me);
      const line2 = [cf.country, cf.region, cf.city].filter(Boolean).join(' ');
      return new Response(`${ip}\n${line2}\nAS${cf.asn || ''}\n${cf.asOrganization || ''}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
    }

    if (path === '/api/me') {
      var me = {
        ip, source: 'cloudflare', country: cf.country || '', countryCode: cf.country || '',
        region: cf.region || '', city: cf.city || '', timezone: cf.timezone || '',
        lat: cf.latitude != null ? Number(cf.latitude) : null, lon: cf.longitude != null ? Number(cf.longitude) : null,
        asn: cf.asn ? `AS${cf.asn}` : '', as: cf.asn ? `AS${cf.asn}` : '', asname: cf.asOrganization || '', org: cf.asOrganization || '', isp: cf.asOrganization || '',
        colo: cf.colo || '', postalCode: cf.postalCode || '', zip: cf.postalCode || '',
        mobile: false, proxy: false, hosting: false,
      };
      return json(Object.assign(me, withCn(me)));
    }

    if (path === '/api/lookup') {
      const q = (url.searchParams.get('ip') || '').trim();
      if (!q || !isIP(q)) return json({ error: 'bad_ip', message: '请传一个有效的 IP' }, 400);
      const data = await cachedLookup(q, ctx);
      if (data.error) return json(data, data.error === 'rate_limited' ? 429 : 502);
      return json(data, 200, 86400);
    }

    if (path === '/api/resolve') {
      const domain = (url.searchParams.get('domain') || '').trim();
      if (!domain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return json({ error: 'bad_domain' }, 400);
      try {
        const [a, aaaa] = await Promise.all([
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`).then(r => r.json()),
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=AAAA`).then(r => r.json()),
        ]);
        const ips = [...(a.Answer || []), ...(aaaa.Answer || [])].map(x => x.data).filter(x => isIP(x));
        return json({ domain, ips: [...new Set(ips)] }, 200, 86400);
      } catch (e) { return json({ error: 'resolve_failed' }, 502); }
    }

    if (path === '/api/rdns') {
      const q = (url.searchParams.get('ip') || '').trim();
      if (!q || !isIP(q)) return json({ error: 'bad_ip', message: '请传一个有效的 IP' }, 400);
      let name;
      if (isIPv4(q)) {
        name = `${q.split('.').reverse().join('.')}.in-addr.arpa`;
      } else {
        // IPv6：展开压缩形式，按 nibble 反转 + ip6.arpa
        const [head, tail] = q.split('::');
        const h = (head ? head.split(':') : []).filter(Boolean);
        const t = (tail ? tail.split(':') : []).filter(Boolean);
        const missing = 8 - h.length - t.length;
        const full = [...h, ...Array(Math.max(0, missing)).fill('0'), ...t]
          .map(g => g.padStart(4, '0')).join('');
        if (full.length !== 32) return json({ ip: q, hostname: '' });
        name = `${full.split('').reverse().join('.')}.ip6.arpa`;
      }
      try {
        const r = await fetch(`https://dns.google/resolve?name=${name}&type=PTR`);
        const d = await r.json();
        const host = (d.Answer || [])[0]?.data || '';
        return json({ ip: q, hostname: host.replace(/\.$/, '') }, 200, 86400);
      } catch (e) { return json({ error: 'rdns_failed' }, 502); }
    }

    if (path === '/api/asn') {
      const m = (url.searchParams.get('as') || '').trim().match(/^AS?(\d+)$/i);
      if (!m) return json({ error: 'bad_asn', message: '请传 AS15169 这样的 ASN' }, 400);
      const num = m[1];
      try {
        const [ov, pf] = await Promise.all([
          fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${num}`).then(r => r.json()),
          fetch(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${num}`).then(r => r.json()),
        ]);
        return json({
          asn: `AS${num}`, holder: ov?.data?.holder || '', announced: !!ov?.data?.announced,
          prefixes: (pf?.data?.prefixes || []).slice(0, 10).map(p => p.prefix),
          source: 'stat.ripe.net',
        }, 200, 86400);
      } catch (e) { return json({ error: 'asn_failed' }, 502); }
    }

    if (path === '/api/rdap') {
      const q = (url.searchParams.get('query') || '').trim();
      if (!q) return json({ error: 'bad_query', message: '请传 IP、ASN 或域名' }, 400);
      let rdapUrl, type;
      const asMatch = q.match(/^AS?(\d+)$/i);
      if (isIP(q)) { rdapUrl = `https://rdap.org/ip/${encodeURIComponent(q)}`; type = 'ip'; }
      else if (asMatch) { rdapUrl = `https://rdap.org/autnum/${asMatch[1]}`; type = 'autnum'; }
      else if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(q)) { rdapUrl = `https://rdap.org/domain/${encodeURIComponent(q)}`; type = 'domain'; }
      else return json({ error: 'bad_query', message: '请传 IP、ASN 或域名' }, 400);
      const cache = caches.default;
      const cacheKey = new Request(`https://rdap.qinlv/${type}/${q}`);
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      try {
        const d = await fetchRdap(rdapUrl, type, q);
        const res = json(normalizeRdap(q, type, d), 200, 86400);
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) { return json({ error: 'rdap_failed', message: 'RDAP 查询失败，请稍候再试' }, 502); }
    }

    if (path === '/api/dns-multi') {
      const domain = (url.searchParams.get('domain') || '').trim();
      const qip = (url.searchParams.get('ip') || '').trim();
      const cache = caches.default;
      if (domain) {
        if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return json({ error: 'bad_domain' }, 400);
        const cacheKey = new Request(`https://dnsmulti.qinlv/${domain}`);
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        const resolvers = await Promise.all(DOH_PROVIDERS.map(async ([id, name]) => {
          const [a, aaaa] = await Promise.all([dohQuery(domain, 'A', id), dohQuery(domain, 'AAAA', id)]);
          return { id, name, a: a || [], aaaa: aaaa || [], ok: a !== null || aaaa !== null };
        }));
        const res = json({ domain, resolvers }, 200, 86400);
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }
      if (qip) {
        if (!isIP(qip)) return json({ error: 'bad_ip' }, 400);
        let name;
        if (isIPv4(qip)) name = `${qip.split('.').reverse().join('.')}.in-addr.arpa`;
        else {
          const [head, tail] = qip.split('::');
          const h = (head ? head.split(':') : []).filter(Boolean);
          const t = (tail ? tail.split(':') : []).filter(Boolean);
          const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(g => g.padStart(4, '0')).join('');
          if (full.length !== 32) return json({ ip: qip, resolvers: [] });
          name = `${full.split('').reverse().join('.')}.ip6.arpa`;
        }
        const resolvers = await Promise.all(DOH_PROVIDERS.map(async ([id, rname]) => {
          const ptr = await dohQuery(name, 'PTR', id);
          return { id, name: rname, ptr: ptr || [], ok: ptr !== null };
        }));
        return json({ ip: qip, resolvers });
      }
      return json({ error: 'bad_query', message: '请传 domain 或 ip' }, 400);
    }

    if (path === '/api') {
      return json({
        name: 'qinlv-ip-query', version: '2.0',
        endpoints: ['GET /api/me', 'GET /api/lookup?ip=8.8.8.8', 'GET /api/rdap?query=8.8.8.8', 'GET /api/dns-multi?domain=dns.google', 'GET /api/dns-multi?ip=8.8.8.8', 'GET /api/resolve?domain=dns.google', 'GET /api/rdns?ip=8.8.8.8', 'GET /api/asn?as=AS15169', 'GET /geo', 'GET /ipv4', 'GET /ipv6'],
      });
    }

    // Top IP 落地页：服务端渲染（可收录）
    const ipMatch = path.match(/^\/ip\/([^/]+)$/);
    if (ipMatch) {
      const q = decodeURIComponent(ipMatch[1]);
      if (isIP(q) && TOP_IPS.includes(q)) {
        const ssr = await renderLanding(request, env, ctx, q);
        if (ssr) return ssr;
      }
    }
    // 静态页面：/ip/<查询> 走 SPA 回退到 index.html
    if (env.ASSETS) {
      let res = await env.ASSETS.fetch(request);
      if (res.status === 404 && (path.startsWith('/ip/') || path === '/ip')) {
        const indexReq = new Request(new URL('/', request.url), request);
        res = await env.ASSETS.fetch(indexReq);
        // 非 Top IP 的 /ip/ 页：SPA 可用，但不参与收录
        // 兜底页不进边缘缓存：上游偶尔失败时回落的 index.html 不能被存下来，
        // 否则下次直接命中缓存，SSR 再也回不来
        const h = new Headers(res.headers);
        h.set('x-robots-tag', 'noindex');
        h.set('cache-control', 'no-store');
        return new Response(res.body, { status: res.status, headers: h });
      }
      if (res.status === 404) {
        return new Response(notFoundPage(), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
      }
      // 静态资源：浏览器每次回源验证，边缘缓存 1 小时、过期后可复用 1 天
      const h = new Headers(res.headers);
      h.set('cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return new Response('Not found', { status: 404 });
  },
};
