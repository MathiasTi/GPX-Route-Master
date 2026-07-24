import { GPXPoint, GPXTrack } from '../types';
import { calculateElevationStats, calculatePowerStats, generateMockSurfaceStats, getLocationName, detectActivityType, findClimbs, sanitizeGPXPoints, calculateSurfaceStatsFromPoints, hydratePointsWithSurface } from './gpxUtils';

const HIGH_CONTRAST_COLORS = [
  '#2563eb', // Velo Royal Blue
  '#0284c7', // Ocean Sky Blue
  '#059669', // Emerald Green
  '#d97706', // Amber Gold
  '#6366f1', // Indigo Blue
  '#0891b2', // Teal
  '#dc2626', // Classic Crimson
  '#7c3aed', // Deep Violet
];

let colorIndex = 0;

const MANUFACTURER_MAP: Record<number, string> = {
  1: 'Garmin',
  2: 'Garmin FR405 ANTFS',
  3: 'Zephyr',
  4: 'Dayton',
  5: 'IDT',
  6: 'SRM',
  7: 'Quarq',
  8: 'iBike',
  9: 'Saris',
  10: 'Spark Instrumentation',
  11: 'Tanita',
  12: 'Echowell',
  13: 'Dynastream OEM',
  14: 'Nautilus',
  15: 'Dynastream',
  16: 'Timex',
  17: 'Metrigear',
  18: 'Xelic',
  19: 'Beurer',
  20: 'Cardiosport',
  21: 'A&D',
  22: 'HMM',
  23: 'Suunto',
  24: 'Thita Elektronik',
  25: 'GPulse',
  26: 'Clean Mobile',
  27: 'Pedal Brain',
  28: 'Peaksware',
  29: 'Saxonar',
  30: 'Lemond Fitness',
  31: 'Dexcom',
  32: 'Wahoo Fitness',
  33: 'Octane Fitness',
  34: 'Archinoetics',
  35: 'The Hurt Box',
  36: 'Citizen Systems',
  37: 'Magellan',
  38: 'Osynce',
  39: 'Holux',
  40: 'Concept2',
  41: 'Shimano',
  42: 'One Giant Leap',
  43: 'Ace Sensor',
  44: 'Brim Brothers',
  45: 'Xplova',
  46: 'Perception Digital',
  47: 'BF1systems',
  48: 'Pioneer',
  49: 'Spantec',
  50: 'Metalogics',
  51: '4iiii',
  52: 'Seiko Epson',
  53: 'Seiko Epson OEM',
  54: 'Ifor Powell',
  55: 'Maxwell Guider',
  56: 'Star Trac',
  57: 'Breakaway',
  58: 'Alatech Technology Ltd',
  59: 'Mio Technology Europe',
  60: 'Rotor',
  61: 'Geonaute',
  62: 'ID Bike',
  63: 'Specialized',
  64: 'WTek',
  65: 'Physical Enterprises',
  66: 'North Pole Engineering',
  67: 'BKOOL',
  68: 'Cateye',
  69: 'Stages Cycling',
  70: 'Sigmasport',
  71: 'TomTom',
  72: 'Peripedal',
  73: 'Wattbike',
  76: 'Moxy',
  77: 'Ciclosport',
  78: 'Powerbahn',
  79: 'Acorn Projects ApS',
  80: 'Lifebeam',
  81: 'Bontrager',
  82: 'Wellgo',
  83: 'Scosche',
  84: 'Magura',
  85: 'Woodway',
  86: 'Elite',
  87: 'Nielsen Kellerman',
  88: 'DK City',
  89: 'Tacx',
  90: 'Direction Technology',
  91: 'Magtonic',
  92: '1partcarbon',
  93: 'Inside Ride Technologies',
  94: 'Sound of Motion',
  95: 'Stryd',
  96: 'ICG (Indoor Cycling Group)',
  97: 'MiPulse',
  98: 'BSX Athletics',
  99: 'Look',
  100: 'Campagnolo SRL',
  101: 'Body Bike Smart',
  102: 'Praxisworks',
  103: 'Limits Technology',
  104: 'TopAction Technology',
  105: 'Cosinuss',
  106: 'Fitcare',
  107: 'Magene',
  108: 'Giant Manufacturing Co',
  109: 'Tigrasport',
  110: 'Salutron',
  111: 'Technogym',
  112: 'Bryton Sensors',
  113: 'Latitude Limited',
  114: 'Soaring Technology',
  115: 'iGPSport',
  116: 'Thinkrider',
  117: 'Gopher Sport',
  118: 'Waterrower',
  119: 'Orangetheory',
  120: 'Inpeak',
  121: 'Kinetic',
  122: 'Johnson Health Tech',
  123: 'Polar Electro',
  124: 'Seesense',
  125: 'NCI Technology',
  126: 'iQsquare',
  127: 'Leomo',
  128: 'iFit.com',
  129: 'Coros Byte',
  130: 'Versa Design',
  131: 'Chileaf',
  132: 'Cycplus',
  133: 'Gravaa Byte',
  134: 'Sigeyi',
  135: 'Coospo',
  136: 'Geoid',
  137: 'Bosch',
  138: 'Kyto',
  139: 'Kinetic Sports',
  140: 'Decathlon Byte',
  141: 'TQ Systems',
  142: 'Tag Heuer',
  143: 'Keiser Fitness',
  144: 'Zwift Byte',
  145: 'Porsche EP',
  146: 'Blackbird',
  147: 'Meilan Byte',
  148: 'Ezon',
  149: 'Laisi',
  150: 'Myzone',
  151: 'Abawo',
  152: 'Bafang',
  153: 'Luhong Technology',
  255: 'Development/Private',
  257: 'Healthandlife',
  258: 'Lezyne',
  259: 'Scribe Labs',
  260: 'Zwift',
  261: 'Watteam',
  262: 'Recon',
  263: 'Favero Electronics',
  264: 'Dynovelo',
  265: 'Strava',
  266: 'Precor',
  267: 'Bryton',
  268: 'SRAM',
  269: 'Navman',
  270: 'COBI',
  271: 'Spivi',
  272: 'Mio Magellan',
  273: 'Evesports',
  274: 'Sensitivus Gauge',
  275: 'Podoon',
  276: 'Life Time Fitness',
  277: 'Falco eMotors',
  278: 'Minoura',
  279: 'Cycliq',
  280: 'Luxottica',
  281: 'TrainerRoad',
  282: 'The Sufferfest',
  283: 'Full Speed Ahead',
  284: 'VirtualTraining',
  285: 'Feedback Sports',
  286: 'Omata',
  287: 'VDO',
  288: 'Magneticdays',
  289: 'Hammerhead',
  290: 'Kinetic by Kurt',
  291: 'Shapelog',
  292: 'Dabuziduo',
  293: 'JetBlack',
  294: 'Coros',
  295: 'Virtugo',
  296: 'Velosense',
  297: 'Cycligent Inc',
  298: 'Trailforks',
  299: 'Mahle Ebikemotion',
  300: 'Nurvv',
  301: 'Microprogram',
  302: 'Zone5cloud',
  303: 'Greenteg',
  304: 'Yamaha Motors',
  305: 'Whoop',
  306: 'Gravaa',
  307: 'Onelap',
  308: 'Monark Exercise',
  309: 'Form',
  310: 'Decathlon',
  311: 'Syncros',
  312: 'Heatup',
  313: 'Cannondale',
  314: 'True Fitness',
  315: 'RGT Cycling',
  316: 'Vasa',
  317: 'Race Republic',
  318: 'Fazua',
  319: 'Oreka Training',
  320: 'LSEC (Lishun Electric & Communication)',
  321: 'Lululemon Studio',
  322: 'Shanyue',
  323: 'Spinning MDA',
  324: 'Hilldating',
  325: 'Aero Sensor',
  326: 'Nike',
  327: 'Magicshine',
  328: 'icTrainer',
  329: 'Absolute Cycling',
  330: 'eo Swimbetter',
  331: 'MyWhoosh',
  332: 'Ravemen',
  333: 'Tektro Racing Products',
  334: 'Darad Innovation Corporation',
  335: 'Cycloptim',
  337: 'Runna',
  339: 'Zepp',
  340: 'Peloton',
  341: 'Carv',
  342: 'Tissot',
  345: 'Real Velo',
  346: 'Wetech',
  347: 'Jespr',
  348: 'Huawei',
  349: 'Gotoes',
  350: 'Cadence App',
  5759: 'Actigraph Corp'
};

const PRODUCT_MAP: Record<number, string> = {
  1: 'hrm1',
  2: 'axh01',
  3: 'axb01',
  4: 'axb02',
  5: 'hrm2ss',
  6: 'dsi_alf02',
  7: 'hrm3ss',
  8: 'hrm_run_single_byte_id',
  9: 'bsm',
  10: 'bcm',
  11: 'axs01',
  12: 'hrm_tri_single_byte_id',
  13: 'hrm4_run_single_byte_id',
  14: 'fr225_single_byte_id',
  15: 'gen3_bsm_single_byte_id',
  16: 'gen3_bcm_single_byte_id',
  22: 'hrm_fit_single_byte_id',
  255: 'OHR',
  473: 'fr301_china',
  474: 'fr301_japan',
  475: 'fr301_korea',
  494: 'fr301_taiwan',
  717: 'fr405',
  782: 'fr50',
  987: 'fr405_japan',
  988: 'fr60',
  1011: 'dsi_alf01',
  1018: 'fr310xt',
  1036: 'edge500',
  1124: 'fr110',
  1169: 'edge800',
  1199: 'edge500_taiwan',
  1213: 'edge500_japan',
  1253: 'chirp',
  1274: 'fr110_japan',
  1325: 'edge200',
  1328: 'fr910xt',
  1333: 'edge800_taiwan',
  1334: 'edge800_japan',
  1341: 'alf04',
  1345: 'fr610',
  1360: 'fr210_japan',
  1380: 'vector_ss',
  1381: 'vector_cp',
  1386: 'edge800_china',
  1387: 'edge500_china',
  1405: 'approach_g10',
  1410: 'fr610_japan',
  1422: 'edge500_korea',
  1436: 'fr70',
  1446: 'fr310xt_4t',
  1461: 'amx',
  1482: 'fr10',
  1497: 'edge800_korea',
  1499: 'swim',
  1537: 'fr910xt_china',
  1551: 'fenix',
  1555: 'edge200_taiwan',
  1561: 'edge510',
  1567: 'edge810',
  1570: 'tempe',
  1600: 'fr910xt_japan',
  1623: 'fr620',
  1632: 'fr220',
  1664: 'fr910xt_korea',
  1688: 'fr10_japan',
  1721: 'edge810_japan',
  1735: 'virb_elite',
  1736: 'edge_touring',
  1742: 'edge510_japan',
  1743: 'hrm_tri',
  1752: 'hrm_run',
  1765: 'fr920xt',
  1821: 'edge510_asia',
  1822: 'edge810_china',
  1823: 'edge810_taiwan',
  1836: 'edge1000',
  1837: 'vivo_fit',
  1853: 'virb_remote',
  1885: 'vivo_ki',
  1903: 'fr15',
  1907: 'vivo_active',
  1918: 'edge510_korea',
  1928: 'fr620_japan',
  1929: 'fr620_china',
  1930: 'fr220_japan',
  1931: 'fr220_china',
  1936: 'approach_s6',
  1956: 'vivo_smart',
  1967: 'fenix2',
  1988: 'epix',
  2050: 'fenix3',
  2052: 'edge1000_taiwan',
  2053: 'edge1000_japan',
  2061: 'fr15_japan',
  2067: 'edge520',
  2070: 'edge1000_china',
  2072: 'fr620_russia',
  2073: 'fr220_russia',
  2079: 'vector_s',
  2100: 'edge1000_korea',
  2130: 'fr920xt_taiwan',
  2131: 'fr920xt_china',
  2132: 'fr920xt_japan',
  2134: 'virbx',
  2135: 'vivo_smart_apac',
  2140: 'etrex_touch',
  2147: 'edge25',
  2148: 'fr25',
  2150: 'vivo_fit2',
  2153: 'fr225',
  2156: 'fr630',
  2157: 'fr230',
  2158: 'fr735xt',
  2160: 'vivo_active_apac',
  2161: 'vector_2',
  2162: 'vector_2s',
  2172: 'virbxe',
  2173: 'fr620_taiwan',
  2174: 'fr220_taiwan',
  2175: 'truswing',
  2187: 'd2airvenu',
  2188: 'fenix3_china',
  2189: 'fenix3_twn',
  2192: 'varia_headlight',
  2193: 'varia_taillight_old',
  2204: 'edge_explore_1000',
  2219: 'fr225_asia',
  2225: 'varia_radar_taillight',
  2226: 'varia_radar_display',
  2238: 'edge20',
  2260: 'edge520_asia',
  2261: 'edge520_japan',
  2262: 'd2_bravo',
  2266: 'approach_s20',
  2271: 'vivo_smart2',
  2274: 'edge1000_thai',
  2276: 'varia_remote',
  2288: 'edge25_asia',
  2289: 'edge25_jpn',
  2290: 'edge20_asia',
  2292: 'approach_x40',
  2293: 'fenix3_japan',
  2294: 'vivo_smart_emea',
  2310: 'fr630_asia',
  2311: 'fr630_jpn',
  2313: 'fr230_jpn',
  2327: 'hrm4_run',
  2332: 'epix_japan',
  2337: 'vivo_active_hr',
  2347: 'vivo_smart_gps_hr',
  2348: 'vivo_smart_hr',
  2361: 'vivo_smart_hr_asia',
  2362: 'vivo_smart_gps_hr_asia',
  2368: 'vivo_move',
  2379: 'varia_taillight',
  2396: 'fr235_asia',
  2397: 'fr235_japan',
  2398: 'varia_vision',
  2406: 'vivo_fit3',
  2407: 'fenix3_korea',
  2408: 'fenix3_sea',
  2413: 'fenix3_hr',
  2417: 'virb_ultra_30',
  2429: 'index_smart_scale',
  2431: 'fr235',
  2432: 'fenix3_chronos',
  2441: 'oregon7xx',
  2444: 'rino7xx',
  2457: 'epix_korea',
  2473: 'fenix3_hr_chn',
  2474: 'fenix3_hr_twn',
  2475: 'fenix3_hr_jpn',
  2476: 'fenix3_hr_sea',
  2477: 'fenix3_hr_kor',
  2496: 'nautix',
  2497: 'vivo_active_hr_apac',
  2503: 'fr35',
  2512: 'oregon7xx_ww',
  2530: 'edge_820',
  2531: 'edge_explore_820',
  2533: 'fr735xt_apac',
  2534: 'fr735xt_japan',
  2544: 'fenix5s',
  2547: 'd2_bravo_titanium',
  2567: 'varia_ut800',
  2593: 'running_dynamics_pod',
  2599: 'edge_820_china',
  2600: 'edge_820_japan',
  2604: 'fenix5x',
  2606: 'vivo_fit_jr',
  2622: 'vivo_smart3',
  2623: 'vivo_sport',
  2628: 'edge_820_taiwan',
  2629: 'edge_820_korea',
  2630: 'edge_820_sea',
  2650: 'fr35_hebrew',
  2656: 'approach_s60',
  2667: 'fr35_apac',
  2668: 'fr35_japan',
  2675: 'fenix3_chronos_asia',
  2687: 'virb_360',
  2691: 'fr935',
  2697: 'fenix5',
  2700: 'vivoactive3',
  2713: 'edge_1030',
  2727: 'fr35_sea',
  2733: 'fr235_china_nfc',
  2769: 'foretrex_601_701',
  2772: 'vivo_move_hr',
  2787: 'vector_3',
  2796: 'fenix5_asia',
  2797: 'fenix5s_asia',
  2798: 'fenix5x_asia',
  2806: 'approach_z80',
  2814: 'fr35_korea',
  2819: 'd2charlie',
  2831: 'vivo_smart3_apac',
  2832: 'vivo_sport_apac',
  2833: 'fr935_asia',
  2859: 'descent',
  2878: 'vivo_fit4',
  2886: 'fr645',
  2888: 'fr645m',
  2891: 'fr30',
  2900: 'fenix5s_plus',
  2909: 'Edge_130',
  2924: 'edge_1030_asia',
  2927: 'vivosmart_4',
  2945: 'vivo_move_hr_asia',
  2962: 'approach_x10',
  2977: 'fr30_asia',
  2988: 'vivoactive3m_w',
  3003: 'fr645_asia',
  3004: 'fr645m_asia',
  3011: 'edge_explore',
  3028: 'gpsmap66',
  3049: 'approach_s10',
  3066: 'vivoactive3m_l',
  3076: 'fr245',
  3077: 'fr245_music',
  3085: 'approach_g80',
  3092: 'edge_130_asia',
  3095: 'edge_1030_bontrager',
  3110: 'fenix5_plus',
  3111: 'fenix5x_plus',
  3112: 'edge_520_plus',
  3113: 'fr945',
  3121: 'edge_530',
  3122: 'edge_830',
  3126: 'instinct_esports',
  3134: 'fenix5s_plus_apac',
  3135: 'fenix5x_plus_apac',
  3142: 'edge_520_plus_apac',
  3143: 'descent_t1',
  3144: 'fr235l_asia',
  3145: 'fr245_asia',
  3163: 'vivo_active3m_apac',
  3192: 'gen3_bsm',
  3193: 'gen3_bcm',
  3218: 'vivo_smart4_asia',
  3224: 'vivoactive4_small',
  3225: 'vivoactive4_large',
  3226: 'venu',
  3246: 'marq_driver',
  3247: 'marq_aviator',
  3248: 'marq_captain',
  3249: 'marq_commander',
  3250: 'marq_expedition',
  3251: 'marq_athlete',
  3258: 'descent_mk2',
  3282: 'fr45',
  3284: 'gpsmap66i',
  3287: 'fenix6S_sport',
  3288: 'fenix6S',
  3289: 'fenix6_sport',
  3290: 'fenix6',
  3291: 'fenix6x',
  3299: 'hrm_dual',
  3300: 'hrm_pro',
  3308: 'vivo_move3_premium',
  3314: 'approach_s40',
  3321: 'fr245m_asia',
  3349: 'edge_530_apac',
  3350: 'edge_830_apac',
  3378: 'vivo_move3',
  3387: 'vivo_active4_small_asia',
  3388: 'vivo_active4_large_asia',
  3389: 'vivo_active4_oled_asia',
  3405: 'swim2',
  3420: 'marq_driver_asia',
  3421: 'marq_aviator_asia',
  3422: 'vivo_move3_asia',
  3441: 'fr945_asia',
  3446: 'vivo_active3t_chn',
  3448: 'marq_captain_asia',
  3449: 'marq_commander_asia',
  3450: 'marq_expedition_asia',
  3451: 'marq_athlete_asia',
  3461: 'index_smart_scale_2',
  3466: 'instinct_solar',
  3469: 'fr45_asia',
  3473: 'vivoactive3_daimler',
  3498: 'legacy_rey',
  3499: 'legacy_darth_vader',
  3500: 'legacy_captain_marvel',
  3501: 'legacy_first_avenger',
  3512: 'fenix6s_sport_asia',
  3513: 'fenix6s_asia',
  3514: 'fenix6_sport_asia',
  3515: 'fenix6_asia',
  3516: 'fenix6x_asia',
  3535: 'legacy_captain_marvel_asia',
  3536: 'legacy_first_avenger_asia',
  3537: 'legacy_rey_asia',
  3538: 'legacy_darth_vader_asia',
  3542: 'descent_mk2s',
  3558: 'edge_130_plus',
  3570: 'edge_1030_plus',
  3578: 'rally_200',
  3589: 'fr745',
  3596: 'venusq_music',
  3599: 'venusq_music_v2',
  3600: 'venusq',
  3615: 'lily',
  3624: 'marq_adventurer',
  3638: 'enduro',
  3639: 'swim2_apac',
  3648: 'marq_adventurer_asia',
  3652: 'fr945_lte',
  3702: 'descent_mk2_asia',
  3703: 'venu2',
  3704: 'venu2s',
  3737: 'venu_daimler_asia',
  3739: 'marq_golfer',
  3740: 'venu_daimler',
  3794: 'fr745_asia',
  3808: 'varia_rct715',
  3809: 'lily_asia',
  3812: 'edge_1030_plus_asia',
  3813: 'edge_130_plus_asia',
  3823: 'approach_s12',
  3837: 'venusq_asia',
  3843: 'edge_1040',
  3850: 'marq_golfer_asia',
  3851: 'venu2_plus',
  3865: 'gnss',
  3869: 'fr55',
  3872: 'enduro_asia',
  3888: 'instinct_2',
  3889: 'instinct_2s',
  3905: 'fenix7s',
  3906: 'fenix7',
  3907: 'fenix7x',
  3908: 'fenix7s_apac',
  3909: 'fenix7_apac',
  3910: 'fenix7x_apac',
  3927: 'approach_g12',
  3930: 'descent_mk2s_asia',
  3934: 'approach_s42',
  3943: 'epix_gen2',
  3944: 'epix_gen2_apac',
  3949: 'venu2s_asia',
  3950: 'venu2_asia',
  3978: 'fr945_lte_asia',
  3982: 'vivo_move_sport',
  3983: 'vivomove_trend',
  3986: 'approach_S12_asia',
  3990: 'fr255_music',
  3991: 'fr255_small_music',
  3992: 'fr255',
  3993: 'fr255_small',
  4001: 'approach_g12_asia',
  4002: 'approach_s42_asia',
  4005: 'descent_g1',
  4017: 'venu2_plus_asia',
  4024: 'fr955',
  4033: 'fr55_asia',
  4061: 'edge_540',
  4062: 'edge_840',
  4063: 'vivosmart_5',
  4071: 'instinct_2_asia',
  4105: 'marq_gen2',
  4115: 'venusq2',
  4116: 'venusq2music',
  4124: 'marq_gen2_aviator',
  4125: 'd2_air_x10',
  4130: 'hrm_pro_plus',
  4132: 'descent_g1_asia',
  4135: 'tactix7',
  4155: 'instinct_crossover',
  4169: 'edge_explore2',
  4222: 'descent_mk3',
  4223: 'descent_mk3i',
  4233: 'approach_s70',
  4257: 'fr265_large',
  4258: 'fr265_small',
  4260: 'venu3',
  4261: 'venu3s',
  4265: 'tacx_neo_smart',
  4266: 'tacx_neo2_smart',
  4267: 'tacx_neo2_t_smart',
  4268: 'tacx_neo_smart_bike',
  4269: 'tacx_satori_smart',
  4270: 'tacx_flow_smart',
  4271: 'tacx_vortex_smart',
  4272: 'tacx_bushido_smart',
  4273: 'tacx_genius_smart',
  4274: 'tacx_flux_flux_s_smart',
  4275: 'tacx_flux2_smart',
  4276: 'tacx_magnum',
  4305: 'edge_1040_asia',
  4312: 'epix_gen2_pro_42',
  4313: 'epix_gen2_pro_47',
  4314: 'epix_gen2_pro_51',
  4315: 'fr965',
  4341: 'enduro2',
  4374: 'fenix7s_pro_solar',
  4375: 'fenix7_pro_solar',
  4376: 'fenix7x_pro_solar',
  4380: 'lily2',
  4394: 'instinct_2x',
  4426: 'vivoactive5',
  4432: 'fr165',
  4433: 'fr165_music',
  4440: 'edge_1050',
  4442: 'descent_t2',
  4446: 'hrm_fit',
  4472: 'marq_gen2_commander',
  4477: 'lily_athlete',
  4525: 'rally_x10',
  4532: 'fenix8_solar',
  4533: 'fenix8_solar_large',
  4534: 'fenix8_small',
  4536: 'fenix8',
  4556: 'd2_mach1_pro',
  4575: 'enduro3',
  4583: 'instinctE_40mm',
  4584: 'instinctE_45mm',
  4585: 'instinct3_solar_45mm',
  4586: 'instinct3_amoled_45mm',
  4587: 'instinct3_amoled_50mm',
  4588: 'descent_g2',
  4603: 'venu_x1',
  4606: 'hrm_200',
  4625: 'vivoactive6',
  4631: 'fenix8_pro',
  4633: 'edge_550',
  4634: 'edge_850',
  4643: 'venu4',
  4644: 'venu4s',
  4647: 'approachS44',
  4655: 'edge_mtb',
  4656: 'approachS50',
  4666: 'fenix_e',
  4745: 'bounce2',
  4759: 'instinct3_solar_50mm',
  4775: 'tactix8_amoled',
  4776: 'tactix8_solar',
  4814: 'fr170_music',
  4815: 'fr170',
  4825: 'approach_j1',
  4879: 'd2_mach2',
  4916: 'fr70_2026',
  4678: 'instinct_crossover_amoled',
  4944: 'd2_air_x15',
  5056: 'd2_mach2_pro',
  10007: 'sdm4',
  10014: 'edge_remote',
  20533: 'tacx_training_app_win',
  20534: 'tacx_training_app_mac',
  20565: 'tacx_training_app_mac_catalyst',
  20119: 'training_center',
  30045: 'tacx_training_app_android',
  30046: 'tacx_training_app_ios',
  30047: 'tacx_training_app_legacy',
  65531: 'connectiq_simulator',
  65532: 'android_antplus_plugin',
  65534: 'connect'
};

const SPORT_MAP: Record<number, string> = {
  0: 'Generic',
  1: 'Laufen (running)',
  2: 'Radfahren (cycling)',
  3: 'Multisport Transition',
  4: 'Fitness Equipment',
  5: 'Schwimmen (swimming)',
  6: 'Basketball',
  7: 'Soccer',
  8: 'Tennis',
  9: 'American Football',
  10: 'Training',
  11: 'Fitness/Kraftsport (walking/fitness)',
  12: 'Cross Country Skiing',
  13: 'Alpine Skiing',
  14: 'Snowboarding',
  15: 'Rowing',
  16: 'Mountaineering',
  17: 'Hiking',
  18: 'Multisport',
  19: 'Paddling',
  20: 'Flying',
  21: 'E-Biking',
  22: 'Motorcycling',
  23: 'Boating',
  24: 'Driving',
  25: 'Golf',
  26: 'Hang Gliding',
  27: 'Horseback Riding',
  28: 'Hunting',
  29: 'Fishing',
  30: 'Inline Skating',
  31: 'Rock Climbing',
  32: 'Sailing',
  33: 'Ice Skating',
  34: 'Sky Diving',
  35: 'Snowshoeing',
  36: 'Snowmobiling',
  37: 'Stand Up Paddleboarding',
  38: 'Surfing',
  39: 'Wakeboarding',
  40: 'Water Skiing',
  41: 'Kayaking',
  42: 'Rafting',
  43: 'Windsurfing',
  44: 'Kitesurfing',
  45: 'Tactical',
  46: 'Jumpmaster',
  47: 'Boxing',
  48: 'Floor Climbing',
  49: 'Baseball',
  53: 'Diving',
  56: 'Shooting',
  58: 'Winter Sport',
  59: 'Grinding',
  62: 'HIIT',
  63: 'Video Gaming',
  64: 'Racket',
  65: 'Wheelchair Push Walk',
  66: 'Wheelchair Push Run',
  67: 'Meditation',
  68: 'Para Sport',
  69: 'Disc Golf',
  70: 'Team Sport',
  71: 'Cricket',
  72: 'Rugby',
  73: 'Hockey',
  74: 'Lacrosse',
  75: 'Volleyball',
  76: 'Water Tubing',
  77: 'Wakesurfing',
  78: 'Water Sport',
  79: 'Archery',
  80: 'Mixed Martial Arts',
  81: 'Motor Sports',
  82: 'Snorkeling',
  83: 'Dance',
  84: 'Jump Rope',
  85: 'Pool Apnea',
  86: 'Mobility',
  87: 'Geocaching',
  88: 'Canoeing',
  254: 'All (Goals)'
};

const ENUM_MAPS: Record<string, Record<number, string>> = {
  sport: SPORT_MAP,
  sub_sport: {
    0: 'Generic',
    1: 'Treadmill',
    2: 'Street',
    3: 'Trail',
    4: 'Track',
    5: 'Spin',
    6: 'Indoor Cycling',
    7: 'Road',
    8: 'Mountain',
    9: 'Downhill',
    10: 'Recumbent',
    11: 'Cyclocross',
    12: 'Hand Cycling',
    13: 'Track Cycling',
    14: 'Indoor Rowing',
    15: 'Elliptical',
    16: 'Stair Climbing',
    17: 'Lap Swimming',
    18: 'Open Water',
    19: 'Flexibility Training',
    20: 'Strength Training',
    21: 'Warm Up',
    22: 'Match',
    23: 'Exercise',
    24: 'Challenge',
    25: 'Indoor Skiing',
    26: 'Cardio Training',
    27: 'Indoor Walking',
    28: 'E-Bike Fitness',
    29: 'BMX',
    30: 'Casual Walking',
    31: 'Speed Walking',
    32: 'Bike to Run Transition',
    33: 'Run to Bike Transition',
    34: 'Swim to Bike Transition',
    35: 'ATV',
    36: 'Motocross',
    37: 'Backcountry',
    38: 'Resort',
    39: 'RC Drone',
    40: 'Wingsuit',
    41: 'Whitewater',
    42: 'Skate Skiing',
    43: 'Yoga',
    44: 'Pilates',
    45: 'Indoor Running',
    46: 'Gravel Cycling',
    47: 'E-Bike Mountain',
    48: 'Commuting',
    49: 'Mixed Surface',
    50: 'Navigate',
    51: 'Track Me',
    52: 'Map',
    53: 'Single Gas Diving',
    54: 'Multi Gas Diving',
    55: 'Gauge Diving',
    56: 'Apnea Diving',
    57: 'Apnea Hunting',
    58: 'Virtual Activity',
    59: 'Obstacle',
    62: 'Breathing',
    63: 'CCR Diving',
    65: 'Sail Race',
    66: 'Expedition',
    67: 'Ultra Marathon',
    68: 'Indoor Climbing',
    69: 'Bouldering',
    70: 'HIIT',
    71: 'Indoor Grinding',
    72: 'Hunting with Dogs',
    73: 'AMRAP',
    74: 'EMOM',
    75: 'Tabata',
    77: 'ESport',
    78: 'Triathlon',
    79: 'Duathlon',
    80: 'Brick',
    81: 'Swim Run',
    82: 'Adventure Race',
    83: 'Trucker Workout',
    84: 'Pickleball',
    85: 'Padel',
    86: 'Indoor Wheelchair Walk',
    87: 'Indoor Wheelchair Run',
    88: 'Indoor Hand Cycling',
    90: 'Field Hockey',
    91: 'Ice Hockey',
    92: 'Ultimate Disc',
    93: 'Platform Racket',
    94: 'Squash',
    95: 'Badminton',
    96: 'Racquetball',
    97: 'Table Tennis',
    98: 'Overland',
    99: 'Trolling Motor',
    110: 'Fly Canopy',
    111: 'Fly Paraglide',
    112: 'Fly Paramotor',
    113: 'Fly Pressurized',
    114: 'Fly Navigate',
    115: 'Fly Timer',
    116: 'Fly Altimeter',
    117: 'Fly Wx',
    118: 'Fly VFR',
    119: 'Fly IFR',
    121: 'Dynamic Apnea',
    123: 'Enduro',
    124: 'Rucking',
    125: 'Rally',
    126: 'Pool Triathlon',
    127: 'E-Bike Enduro',
    254: 'All'
  },
  event: {
    0: 'Timer',
    3: 'Workout',
    4: 'Workout Step',
    5: 'Power Down',
    6: 'Power Up',
    7: 'Off Course',
    8: 'Session',
    9: 'Lap',
    10: 'Course Point',
    11: 'Battery',
    12: 'Virtual Partner Pace',
    13: 'HR High Alert',
    14: 'HR Low Alert',
    15: 'Speed High Alert',
    16: 'Speed Low Alert',
    17: 'Cadence High Alert',
    18: 'Cadence Low Alert',
    19: 'Power High Alert',
    20: 'Power Low Alert',
    21: 'Recovery HR',
    22: 'Battery Low',
    23: 'Time Duration Alert',
    24: 'Distance Duration Alert',
    25: 'Calorie Duration Alert',
    26: 'Activity',
    27: 'Fitness Equipment',
    28: 'Length',
    32: 'User Marker',
    33: 'Sport Point',
    36: 'Calibration',
    42: 'Front Gear Change',
    43: 'Rear Gear Change',
    44: 'Rider Position Change',
    45: 'Elev High Alert',
    46: 'Elev Low Alert',
    47: 'Comm Timeout',
    54: 'Auto Activity Detect',
    56: 'Dive Alert',
    57: 'Dive Gas Switched',
    71: 'Tank Pressure Reserve',
    72: 'Tank Pressure Critical',
    73: 'Tank Lost',
    75: 'Radar Threat Alert',
    76: 'Tank Battery Low',
    81: 'Tank Pod Connected',
    82: 'Tank Pod Disconnected'
  },
  event_type: {
    0: 'Start',
    1: 'Stop',
    2: 'Consecutive Deprecated',
    3: 'Marker',
    4: 'Stop All',
    5: 'Begin Deprecated',
    6: 'End Deprecated',
    7: 'End All Deprecated',
    8: 'Stop Disable',
    9: 'Stop Disable All'
  },
  timer_trigger: {
    0: 'Manual',
    1: 'Auto',
    2: 'Fitness Equipment'
  },
  session_trigger: {
    0: 'Activity End',
    1: 'Manual (User changed sport)',
    2: 'Auto Multi-Sport',
    3: 'Fitness Equipment Link'
  },
  autolap_trigger: {
    0: 'Time',
    1: 'Distance',
    2: 'Position Start',
    3: 'Position Lap',
    4: 'Position Waypoint',
    5: 'Position Marked',
    6: 'Off',
    13: 'Auto Select'
  },
  lap_trigger: {
    0: 'Manual',
    1: 'Time',
    2: 'Distance',
    3: 'Position Start',
    4: 'Position Lap',
    5: 'Position Waypoint',
    6: 'Position Marked',
    7: 'Session End',
    8: 'Fitness Equipment'
  },
  battery_status: {
    1: 'New',
    2: 'Good',
    3: 'Ok',
    4: 'Low',
    5: 'Critical',
    6: 'Charging',
    7: 'Unknown'
  },
  swim_stroke: {
    0: 'Freestyle',
    1: 'Backstroke',
    2: 'Breaststroke',
    3: 'Butterfly',
    4: 'Drill',
    5: 'Mixed',
    6: 'IM (Individual Medley)',
    7: 'IM by Round',
    8: 'Reverse IM Order'
  },
  activity_type: {
    0: 'Generic',
    1: 'Running',
    2: 'Cycling',
    3: 'Transition',
    4: 'Fitness Equipment',
    5: 'Swimming',
    6: 'Walking',
    8: 'Sedentary',
    254: 'All (Goals)'
  },
  activity_subtype: {
    0: 'Generic',
    1: 'Treadmill',
    2: 'Street',
    3: 'Trail',
    4: 'Track',
    5: 'Spin',
    6: 'Indoor Cycling',
    7: 'Road',
    8: 'Mountain',
    9: 'Downhill',
    10: 'Recumbent',
    11: 'Cyclocross',
    12: 'Hand Cycling',
    13: 'Track Cycling',
    14: 'Indoor Rowing',
    15: 'Elliptical',
    16: 'Stair Climbing',
    17: 'Lap Swimming',
    18: 'Open Water',
    254: 'All'
  },
  activity_level: {
    0: 'Low',
    1: 'Medium',
    2: 'High'
  },
  gender: {
    0: 'Female',
    1: 'Male'
  },
  language: {
    0: 'English',
    1: 'French',
    2: 'Italian',
    3: 'German',
    4: 'Spanish',
    5: 'Croatian',
    6: 'Czech',
    7: 'Danish',
    8: 'Dutch',
    9: 'Finnish',
    10: 'Greek',
    11: 'Hungarian',
    12: 'Norwegian',
    13: 'Polish',
    14: 'Portuguese',
    15: 'Slovakian',
    16: 'Slovenian',
    17: 'Swedish',
    18: 'Russian',
    19: 'Turkish',
    20: 'Latvian',
    21: 'Ukrainian',
    22: 'Arabic',
    23: 'Farsi',
    24: 'Bulgarian',
    25: 'Romanian',
    26: 'Chinese',
    27: 'Japanese',
    28: 'Korean',
    29: 'Taiwanese',
    30: 'Thai',
    31: 'Hebrew',
    32: 'Brazilian Portuguese',
    33: 'Indonesian',
    34: 'Malaysian',
    35: 'Vietnamese',
    36: 'Burmese',
    37: 'Mongolian',
    254: 'Custom'
  },
  time_zone: {
    0: 'Almaty',
    1: 'Bangkok',
    2: 'Bombay',
    3: 'Brasilia',
    4: 'Cairo',
    5: 'Cape Verde Is',
    6: 'Darwin',
    7: 'Eniwetok',
    8: 'Fiji',
    9: 'Hong Kong',
    10: 'Islamabad',
    11: 'Kabul',
    12: 'Magadan',
    13: 'Mid Atlantic',
    14: 'Moscow',
    15: 'Muscat',
    16: 'Newfoundland',
    17: 'Samoa',
    18: 'Sydney',
    19: 'Tehran',
    20: 'Tokyo',
    21: 'US Alaska',
    22: 'US Atlantic',
    23: 'US Central',
    24: 'US Eastern',
    25: 'US Hawaii',
    26: 'US Mountain',
    27: 'US Pacific',
    28: 'Other',
    29: 'Auckland',
    30: 'Kathmandu',
    31: 'Europe Western WET',
    32: 'Europe Central CET',
    33: 'Europe Eastern EET',
    34: 'Jakarta',
    35: 'Perth',
    36: 'Adelaide',
    37: 'Brisbane',
    38: 'Tasmania',
    39: 'Iceland',
    40: 'Amsterdam',
    41: 'Athens',
    42: 'Barcelona',
    43: 'Berlin',
    44: 'Brussels',
    45: 'Budapest',
    46: 'Copenhagen',
    47: 'Dublin',
    48: 'Helsinki',
    49: 'Lisbon',
    50: 'London',
    51: 'Madrid',
    52: 'Munich',
    53: 'Oslo',
    54: 'Paris',
    55: 'Prague',
    56: 'Reykjavik',
    57: 'Rome',
    58: 'Stockholm',
    59: 'Vienna',
    60: 'Warsaw',
    61: 'Zurich',
    62: 'Quebec',
    63: 'Ontario',
    64: 'Manitoba',
    65: 'Saskatchewan',
    66: 'Alberta',
    67: 'British Columbia',
    68: 'Boise',
    69: 'Boston',
    70: 'Chicago',
    71: 'Dallas',
    72: 'Denver',
    73: 'Kansas City',
    74: 'Las Vegas',
    75: 'Los Angeles',
    76: 'Miami',
    77: 'Minneapolis',
    78: 'New York',
    79: 'New Orleans',
    80: 'Phoenix',
    81: 'Santa Fe',
    82: 'Seattle',
    83: 'Washington DC',
    84: 'US Arizona',
    85: 'Chita',
    86: 'Ekaterinburg',
    87: 'Irkutsk',
    88: 'Kaliningrad',
    89: 'Krasnoyarsk',
    90: 'Novosibirsk',
    91: 'Petropavlovsk Kamchatskiy',
    92: 'Samara',
    93: 'Vladivostok',
    94: 'Mexico Central',
    95: 'Mexico Mountain',
    96: 'Mexico Pacific',
    97: 'Cape Town',
    98: 'Winkhoek',
    99: 'Lagos',
    100: 'Riyahd',
    101: 'Venezuela',
    102: 'Australia LH',
    103: 'Santiago',
    253: 'Manual',
    254: 'Automatic'
  },
  display_measure: {
    0: 'Metric',
    1: 'Statute',
    2: 'Nautical'
  },
  display_heart: {
    0: 'BPM',
    1: 'Max',
    2: 'Reserve'
  },
  display_power: {
    0: 'Watts',
    1: 'Percent FTP'
  },
  display_position: {
    0: 'Degree (dd.dddddd)',
    1: 'Degree Minute (dddmm.mmm)',
    2: 'Degree Minute Second (dddmmss)',
    3: 'Austrian Grid (BMN)',
    4: 'British National Grid',
    5: 'Dutch Grid System',
    6: 'Hungarian Grid System',
    7: 'Finnish Grid System KKJ27',
    8: 'German Grid (Gauss Krueger)',
    9: 'Icelandic Grid',
    10: 'Indonesian Equatorial LCO',
    11: 'Indonesian Irian LCO',
    12: 'Indonesian Southern LCO',
    13: 'India Zone 0',
    14: 'India Zone IA',
    15: 'India Zone IB',
    16: 'India Zone IIA',
    17: 'India Zone IIB',
    18: 'India Zone IIIA',
    19: 'India Zone IIIB',
    20: 'India Zone IVA',
    21: 'India Zone IVB',
    22: 'Irish Transverse Mercator',
    23: 'Irish Grid',
    24: 'Loran TD',
    25: 'Maidenhead Grid System',
    26: 'MGRS Grid System',
    27: 'New Zealand Grid System',
    28: 'New Zealand Transverse Mercator',
    29: 'Qatar National Grid',
    30: 'Modified RT-90 (Sweden)',
    31: 'RT-90 (Sweden)',
    32: 'South African Grid',
    33: 'Swiss CH-1903 Grid',
    34: 'Taiwan Grid',
    35: 'United States National Grid',
    36: 'UTM/UPS Grid System',
    37: 'West Malayan RSO',
    38: 'Borneo RSO',
    39: 'Estonian Grid System',
    40: 'Latvian Transverse Mercator',
    41: 'Reference Grid 99 TM (Sweden)'
  },
  switch: {
    0: 'Off',
    1: 'On',
    2: 'Auto'
  },
  intensity: {
    0: 'Active',
    1: 'Rest',
    2: 'Warmup',
    3: 'Cooldown',
    4: 'Recovery',
    5: 'Interval',
    6: 'Other'
  },
  side: {
    0: 'Right',
    1: 'Left'
  },
  length_type: {
    0: 'Idle (Rest Period)',
    1: 'Active (with strokes)'
  },
  day_of_week: {
    0: 'Sunday',
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday'
  },
  weather_report: {
    0: 'Current',
    1: 'Hourly Forecast',
    2: 'Daily Forecast'
  },
  weather_status: {
    0: 'Clear',
    1: 'Partly Cloudy',
    2: 'Mostly Cloudy',
    3: 'Rain',
    4: 'Snow',
    5: 'Windy',
    6: 'Thunderstorms',
    7: 'Wintry Mix',
    8: 'Fog',
    11: 'Hazy',
    12: 'Hail',
    13: 'Scattered Showers',
    14: 'Scattered Thunderstorms',
    15: 'Unknown Precipitation',
    16: 'Light Rain',
    17: 'Heavy Rain',
    18: 'Light Snow',
    19: 'Heavy Snow',
    20: 'Light Rain/Snow',
    21: 'Heavy Rain/Snow',
    22: 'Cloudy'
  },
  stroke_type: {
    0: 'No Event',
    1: 'Other',
    2: 'Serve',
    3: 'Forehand',
    4: 'Backhand',
    5: 'Smash'
  },
  body_location: {
    0: 'Left Leg',
    1: 'Left Calf',
    2: 'Left Shin',
    3: 'Left Hamstring',
    4: 'Left Quad',
    5: 'Left Glute',
    6: 'Right Leg',
    7: 'Right Calf',
    8: 'Right Shin',
    9: 'Right Hamstring',
    10: 'Right Quad',
    11: 'Right Glute',
    12: 'Torso Back',
    13: 'Left Lower Back',
    14: 'Left Upper Back',
    15: 'Right Lower Back',
    16: 'Right Upper Back',
    17: 'Torso Front',
    18: 'Left Abdomen',
    19: 'Left Chest',
    20: 'Right Abdomen',
    21: 'Right Chest',
    22: 'Left Arm',
    23: 'Left Shoulder',
    24: 'Left Bicep',
    25: 'Left Tricep',
    26: 'Left Brachioradialis',
    27: 'Left Forearm Extensors',
    28: 'Right Arm',
    29: 'Right Shoulder',
    30: 'Right Bicep',
    31: 'Right Tricep',
    32: 'Right Brachioradialis',
    33: 'Right Forearm Extensors',
    34: 'Neck',
    35: 'Throat',
    36: 'Waist Mid Back',
    37: 'Waist Front',
    38: 'Waist Left',
    39: 'Waist Right'
  },
  source_type: {
    0: 'ANT (External)',
    1: 'ANT+ (External)',
    2: 'Bluetooth (External)',
    3: 'Bluetooth Low Energy (External)',
    4: 'Wi-Fi (External)',
    5: 'Local (Onboard)'
  },
  local_device_type: {
    0: 'GPS',
    1: 'GLONASS',
    2: 'GPS + GLONASS',
    3: 'Accelerometer',
    4: 'Barometer',
    5: 'Temperature Sensor',
    10: 'Wrist Heart Rate',
    12: 'Sensor Hub'
  },
  ble_device_type: {
    0: 'Connected GPS',
    1: 'Heart Rate',
    2: 'Bike Power',
    3: 'Bike Speed + Cadence',
    4: 'Bike Speed',
    5: 'Bike Cadence',
    6: 'Footpod',
    7: 'Bike Trainer (FTMS)'
  },
  rider_position_type: {
    0: 'Seated',
    1: 'Standing',
    2: 'Transition to Seated',
    3: 'Transition to Standing'
  },
  turn_type: {
    0: 'Arriving',
    1: 'Arriving Left',
    2: 'Arriving Right',
    3: 'Arriving Via',
    4: 'Arriving Via Left',
    5: 'Arriving Via Right',
    6: 'Bear/Keep Left',
    7: 'Bear/Keep Right',
    8: 'Continue',
    9: 'Exit Left',
    10: 'Exit Right',
    11: 'Ferry',
    12: 'Roundabout 45°',
    13: 'Roundabout 90°',
    14: 'Roundabout 135°',
    15: 'Roundabout 180°',
    16: 'Roundabout 225°',
    17: 'Roundabout 270°',
    18: 'Roundabout 315°',
    19: 'Roundabout 360°',
    20: 'Roundabout Neg 45°',
    21: 'Roundabout Neg 90°',
    22: 'Roundabout Neg 135°',
    23: 'Roundabout Neg 180°',
    24: 'Roundabout Neg 225°',
    25: 'Roundabout Neg 270°',
    26: 'Roundabout Neg 315°',
    27: 'Roundabout Neg 360°',
    28: 'Roundabout Generic',
    29: 'Roundabout Neg Generic',
    30: 'Sharp Turn Left',
    31: 'Sharp Turn Right',
    32: 'Turn Left',
    33: 'Turn Right',
    34: 'U-Turn Left',
    35: 'U-Turn Right',
    36: 'Icon Inv',
    37: 'Icon Count'
  },
  set_type: {
    0: 'Rest',
    1: 'Active'
  },
  type: {
    1: 'Device (Read only)',
    2: 'Settings (Read/write)',
    3: 'Sport (Read/write)',
    4: 'Activity (Read/erase)',
    5: 'Workout (Read/write/erase)',
    6: 'Course (Read/write/erase)',
    7: 'Schedules (Read/write)',
    9: 'Weight (Read only)',
    10: 'Totals (Read only)',
    11: 'Goals (Read/write)',
    14: 'Blood Pressure (Read only)',
    15: 'Monitoring A (Read only)',
    20: 'Activity Summary (Read/erase)',
    28: 'Monitoring Daily',
    32: 'Monitoring B (Read only)',
    34: 'Segment (Read/write/erase)',
    35: 'Segment List (Read/write/erase)',
    40: 'Exd Configuration (Read/write/erase)'
  }
};

const getManufacturerName = (idStr: string | undefined): string | undefined => {
  if (!idStr) return undefined;
  const num = Number(idStr);
  if (!isNaN(num) && MANUFACTURER_MAP[num]) {
    return MANUFACTURER_MAP[num];
  }
  return idStr;
};

const getProductModelName = (prodStr: string | undefined): string | undefined => {
  if (!prodStr) return undefined;
  const num = Number(prodStr);
  if (!isNaN(num) && PRODUCT_MAP[num]) {
    return PRODUCT_MAP[num];
  }
  return prodStr;
};

const getSportLabel = (sportStr: string | undefined): string | undefined => {
  if (!sportStr) return undefined;
  const num = Number(sportStr);
  if (!isNaN(num) && SPORT_MAP[num]) {
    return SPORT_MAP[num];
  }
  return sportStr;
};

export function getMessageName(globalMsgNum: number): string {
  const map: Record<number, string> = {
    0: 'file_id',
    1: 'capabilities',
    2: 'device_settings',
    3: 'user_profile',
    4: 'hrm_profile',
    5: 'sdm_profile',
    6: 'bike_profile',
    7: 'zones_target',
    8: 'hr_zone',
    9: 'power_zone',
    10: 'met_zone',
    12: 'sport',
    13: 'training_settings',
    15: 'goal',
    18: 'session',
    19: 'lap',
    20: 'record',
    21: 'event',
    23: 'device_info',
    26: 'workout',
    27: 'workout_step',
    28: 'schedule',
    30: 'weight_scale',
    31: 'course',
    32: 'course_point',
    33: 'totals',
    34: 'activity',
    35: 'software',
    37: 'file_capabilities',
    38: 'mesg_capabilities',
    39: 'field_capabilities',
    49: 'file_creator',
    51: 'blood_pressure',
    53: 'speed_zone',
    55: 'monitoring',
    72: 'training_file',
    78: 'hrv',
    80: 'ant_rx',
    81: 'ant_tx',
    82: 'ant_channel_id',
    101: 'length',
    103: 'monitoring_info',
    105: 'pad',
    106: 'slave_device',
    127: 'connectivity',
    128: 'weather_conditions',
    129: 'weather_alert',
    131: 'cadence_zone',
    132: 'hr',
    140: 'garmin_connect_metadata',
    142: 'segment_lap',
    145: 'memo_glob',
    148: 'segment_id',
    149: 'segment_leaderboard_entry',
    150: 'segment_point',
    151: 'segment_file',
    158: 'workout_session',
    159: 'watchface_settings',
    160: 'gps_metadata',
    161: 'camera_event',
    162: 'timestamp_correlation',
    164: 'gyroscope_data',
    165: 'accelerometer_data',
    167: 'three_d_sensor_calibration',
    169: 'video_frame',
    174: 'obdii_data',
    177: 'nmea_sentence',
    178: 'aviation_attitude',
    184: 'video',
    185: 'video_title',
    186: 'video_description',
    187: 'video_clip',
    188: 'ohr_settings',
    200: 'exd_screen_configuration',
    201: 'exd_data_field_configuration',
    202: 'exd_data_concept_configuration',
    206: 'field_description',
    207: 'developer_data_id',
    208: 'magnetometer_data',
    209: 'barometer_data',
    210: 'one_d_sensor_calibration',
    211: 'monitoring_hr_data',
    216: 'time_in_zone',
    225: 'set',
    227: 'stress_level',
    229: 'max_met_data',
    258: 'dive_settings',
    259: 'dive_gas',
    262: 'dive_alarm',
    264: 'exercise_title',
    268: 'dive_summary',
    269: 'spo2_data',
    275: 'sleep_level',
    285: 'jump',
    289: 'aad_accel_features',
    290: 'beat_intervals',
    297: 'respiration_rate',
    302: 'hsa_accelerometer_data',
    304: 'hsa_step_data',
    305: 'hsa_spo2_data',
    306: 'hsa_stress_data',
    307: 'hsa_respiration_data',
    308: 'hsa_heart_rate_data',
    312: 'split',
    313: 'split_summary',
    314: 'hsa_body_battery_data',
    315: 'hsa_event',
    317: 'climb_pro',
    319: 'tank_update',
    323: 'tank_summary',
    346: 'sleep_assessment',
    370: 'hrv_status_summary',
    371: 'hrv_value',
    372: 'raw_bbi',
    375: 'device_aux_battery_info',
    376: 'hsa_gyroscope_data',
    387: 'chrono_shot_session',
    388: 'chrono_shot_data',
    389: 'hsa_configuration_data',
    393: 'dive_apnea_alarm',
    398: 'skin_temp_overnight',
    409: 'hsa_wrist_temperature_data',
    412: 'nap_event',
    470: 'sleep_disruption_severity_period',
    471: 'sleep_disruption_overnight_severity'
  };
  return map[globalMsgNum] || `message_type_${globalMsgNum}`;
}

const FIELD_NAMES: Record<number, Record<number, string>> = {
  0: { // file_id
    0: 'type',
    1: 'manufacturer',
    2: 'product',
    3: 'serial_number',
    4: 'time_created',
    5: 'number',
    8: 'product_name'
  },
  2: { // device_settings
    0: 'active_time_zone',
    1: 'utc_offset',
    2: 'time_zone_offset',
    5: 'backlight_mode'
  },
  3: { // user_profile
    0: 'friendly_name',
    1: 'gender',
    2: 'age',
    3: 'height',
    4: 'weight',
    5: 'language'
  },
  7: { // zones_target
    1: 'functional_threshold_power',
    2: 'max_heart_rate',
    3: 'threshold_heart_rate'
  },
  12: { // sport
    0: 'sport',
    1: 'sub_sport',
    3: 'name'
  },
  18: { // session
    0: 'event',
    1: 'event_type',
    2: 'start_time',
    3: 'start_position_lat',
    4: 'start_position_long',
    5: 'sport',
    6: 'sub_sport',
    7: 'total_elapsed_time',
    8: 'total_timer_time',
    9: 'total_distance',
    10: 'total_cycles',
    11: 'total_calories',
    13: 'avg_speed',
    14: 'max_speed',
    15: 'avg_heart_rate',
    16: 'max_heart_rate',
    17: 'avg_cadence',
    18: 'max_cadence',
    19: 'avg_power',
    20: 'max_power',
    21: 'total_ascent',
    22: 'total_descent',
    28: 'normalized_power',
    29: 'training_stress_score',
    30: 'intensity_factor',
    83: 'session_name',
    110: 'comment'
  },
  19: { // lap
    0: 'event',
    1: 'event_type',
    2: 'start_time',
    3: 'start_position_lat',
    4: 'start_position_long',
    5: 'end_position_lat',
    6: 'end_position_long',
    7: 'total_elapsed_time',
    8: 'total_timer_time',
    9: 'total_distance',
    11: 'total_calories',
    13: 'avg_speed',
    14: 'max_speed',
    15: 'avg_heart_rate',
    16: 'max_heart_rate',
    17: 'avg_cadence',
    18: 'max_cadence',
    19: 'avg_power',
    20: 'max_power',
    21: 'total_ascent',
    22: 'total_descent'
  },
  20: { // record
    0: 'position_lat',
    1: 'position_long',
    2: 'altitude',
    3: 'heart_rate',
    4: 'cadence',
    5: 'distance',
    6: 'speed',
    7: 'power',
    8: 'compressed_speed_distance',
    9: 'grade',
    10: 'resistance',
    13: 'temperature',
    39: 'vertical_oscillation',
    40: 'stance_time_percent',
    41: 'stance_time',
    73: 'enhanced_speed',
    78: 'enhanced_altitude',
    253: 'timestamp'
  },
  21: { // event
    0: 'event',
    1: 'event_type',
    2: 'data',
    3: 'event_group'
  },
  23: { // device_info
    0: 'device_index',
    1: 'device_type',
    2: 'manufacturer',
    3: 'serial_number',
    4: 'product',
    5: 'software_version',
    6: 'hardware_version',
    7: 'cum_operating_time',
    25: 'source_type'
  },
  26: { // workout
    4: 'sport',
    5: 'capabilities',
    6: 'workout_name',
    8: 'notes'
  },
  31: { // course
    4: 'sport',
    5: 'course_name',
    6: 'capabilities'
  },
  32: { // course_point
    1: 'timestamp',
    2: 'position_lat',
    3: 'position_long',
    4: 'distance',
    5: 'type',
    6: 'name'
  },
  34: { // activity
    0: 'total_timer_time',
    1: 'num_sessions',
    2: 'type',
    3: 'event',
    4: 'event_type',
    5: 'local_timestamp',
    11: 'activity_name',
    12: 'comment'
  },
  35: { // software
    3: 'version',
    5: 'part_number'
  },
  37: { // file_capabilities
    0: 'type',
    1: 'flags',
    2: 'directory',
    3: 'max_count',
    4: 'max_size'
  },
  38: { // mesg_capabilities
    0: 'file',
    1: 'mesg_num',
    2: 'count_type',
    3: 'count'
  },
  39: { // field_capabilities
    0: 'file',
    1: 'mesg_num',
    2: 'field_num',
    3: 'count'
  },
  49: { // file_creator
    0: 'software_version',
    1: 'hardware_version'
  },
  140: { // garmin_connect_metadata
    0: 'sync_source',
    1: 'sync_time',
    2: 'sync_platform',
    3: 'app_version',
    4: 'device_os'
  },
  148: { // segment_id
    0: 'name',
    1: 'uuid',
    2: 'sport',
    3: 'enabled'
  },
  200: { // exd_screen_configuration
    0: 'screen_index',
    1: 'field_count',
    2: 'layout',
    3: 'screen_enabled'
  },
  201: { // exd_data_field_configuration
    0: 'screen_index',
    1: 'field_index',
    2: 'concept_count',
    3: 'display_format'
  },
  202: { // exd_data_concept_configuration
    0: 'screen_index',
    1: 'field_index',
    2: 'concept_index',
    3: 'data_type'
  },
  206: { // field_description
    0: 'developer_data_index',
    1: 'field_definition_number',
    2: 'fit_base_type_id',
    3: 'field_name',
    4: 'units'
  },
  207: { // developer_data_id
    0: 'developer_id',
    1: 'application_id',
    2: 'manufacturer_id',
    3: 'developer_data_index'
  },
  258: { // dive_settings
    0: 'name',
    1: 'model'
  },
  269: { // spo2_data
    0: 'timestamp',
    1: 'spo2'
  },
  275: { // sleep_level
    0: 'timestamp',
    1: 'sleep_level'
  },
  297: { // respiration_rate
    0: 'timestamp',
    1: 'respiration_rate'
  }
};

interface LocalDefinition {
  localMessageType: number;
  globalMessageNumber: number;
  fields: { recordNumber: number; size: number; baseType: number }[];
  developerFields?: { field_definition_number: number; size: number; developer_data_index: number }[];
}

function parseRecordHeader(headerByte: number) {
  const result: any = {};
  if ((headerByte & 0b10000000) === 0) {
    // Normal Header
    result.headerType = 'NORMAL';
    result.messageType = (headerByte & 0b1000000) > 0 ? 'DEFINITION' : 'DATA';
    result.developerData = (headerByte & 0b100000) > 0;
    result.localMessageType = headerByte & 0b1111;
  } else {
    // compressed timestamp header
    result.headerType = 'COMPRESSED';
    result.messageType = 'DATA';
    result.localMessageType = (headerByte & 0b1100000) >> 5;
    result.timestampOffset = headerByte & 0b11111;
  }
  return result;
}

function readDataField(baseType: number, view: DataView, pointer: number, size: number, littleEndian: boolean): any {
  if (pointer + size > view.byteLength) return undefined;
  switch (baseType) {
    case 0x00: return view.getUint8(pointer);
    case 0x01: return view.getInt8(pointer);
    case 0x02: return view.getUint8(pointer);
    case 0x83: return view.getInt16(pointer, littleEndian);
    case 0x84: return view.getUint16(pointer, littleEndian);
    case 0x85: return view.getInt32(pointer, littleEndian);
    case 0x86: return view.getUint32(pointer, littleEndian);
    case 0x0A: return view.getUint8(pointer);
    case 0x8B: return view.getUint16(pointer, littleEndian);
    case 0x8C: return view.getUint32(pointer, littleEndian);
    case 0x88: return view.getFloat32(pointer, littleEndian);
    case 0x89: return view.getFloat64(pointer, littleEndian);
    case 0x0D: {
      const res = [];
      for (let i = 0; i < size; i++) res.push(view.getUint8(pointer + i));
      return res;
    }
    case 0x8E: return view.getBigInt64 ? Number(view.getBigInt64(pointer, littleEndian)) : 0;
    case 0x8F: return view.getBigUint64 ? Number(view.getBigUint64(pointer, littleEndian)) : 0;
    case 0x90: return view.getBigUint64 ? Number(view.getBigUint64(pointer, littleEndian)) : 0;
    case 0x07: {
      const res = [];
      for (let i = 0; i < size; i++) {
        const char = view.getUint8(pointer + i);
        if (char) res.push(char);
      }
      return String.fromCharCode(...res);
    }
  }
  return undefined;
}

export const parseFIT = async (arrayBuffer: ArrayBuffer, fileName: string): Promise<GPXTrack | null> => {
  try {
    const fit = new DataView(arrayBuffer);
    const points: GPXPoint[] = [];
    const localMessageDefinitions: Record<number, LocalDefinition> = {};
    let latestTimestamp = 0;

    let fitName: string | undefined = undefined;
    let fitNotes: string | undefined = undefined;
    let deviceManufacturer: string | undefined = undefined;
    let deviceModel: string | undefined = undefined;
    let serialNumber: string | undefined = undefined;
    let softwareVersion: string | undefined = undefined;
    let sportName: string | undefined = undefined;
    let sessionDuration: number | undefined = undefined;
    let sessionDistance: number | undefined = undefined;
    let lapCount = 0;
    const rawRecordsForMeta: { type: string; data: Record<string, any> }[] = [];

    let pointer = 0;
    let littleEndian = true;

    while (pointer < fit.byteLength - 2) {
      if (pointer + 12 > fit.byteLength) break;
      
      // 1. Read Header
      const headerSize = fit.getUint8(pointer);
      if (headerSize < 12 || pointer + headerSize > fit.byteLength) {
        break; 
      }
      
      const protocolVersion = fit.getUint8(pointer + 1);
      const profileVersion = fit.getUint16(pointer + 2, littleEndian);
      const dataSize = fit.getUint32(pointer + 4, littleEndian);
      const dataSignature = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(pointer + 8, pointer + 12)));

      let startOfDataRecords = pointer + headerSize;
      let endOfDataRecords = startOfDataRecords + dataSize;
      if (endOfDataRecords > fit.byteLength - 2) {
        endOfDataRecords = fit.byteLength - 2;
      }

      pointer = startOfDataRecords;

      // 2. Read Records sequentially
      while (pointer < endOfDataRecords) {
        if (pointer >= fit.byteLength) break;
        const headerByte = fit.getUint8(pointer);
        const recordHeader = parseRecordHeader(headerByte);

        if (recordHeader.messageType === 'DEFINITION') {
          if (pointer + 6 > fit.byteLength) break;
          const architecture = fit.getUint8(pointer + 2) === 0 ? 'LE' : 'BE';
          littleEndian = architecture === 'LE';
          const globalMessageNumber = fit.getUint16(pointer + 3, littleEndian);
          const fieldsNumber = fit.getUint8(pointer + 5);

          if (pointer + 6 + fieldsNumber * 3 > fit.byteLength) break;
          const fields: { recordNumber: number; size: number; baseType: number }[] = [];
          for (let i = 0; i < fieldsNumber; i++) {
            fields.push({
              recordNumber: fit.getUint8(pointer + 6 + i * 3),
              size: fit.getUint8(pointer + 7 + i * 3),
              baseType: fit.getUint8(pointer + 8 + i * 3),
            });
          }

          let nextPointer = pointer + 6 + fieldsNumber * 3;

          let devFields: { field_definition_number: number; size: number; developer_data_index: number }[] = [];
          if (recordHeader.developerData && nextPointer < fit.byteLength) {
            const devFieldsNumber = fit.getUint8(nextPointer);
            if (nextPointer + 1 + devFieldsNumber * 3 <= fit.byteLength) {
              for (let i = 0; i < devFieldsNumber; i++) {
                devFields.push({
                  field_definition_number: fit.getUint8(nextPointer + 1 + i * 3),
                  size: fit.getUint8(nextPointer + 2 + i * 3),
                  developer_data_index: fit.getUint8(nextPointer + 3 + i * 3),
                });
              }
              nextPointer += 1 + devFieldsNumber * 3;
            }
          }

          localMessageDefinitions[recordHeader.localMessageType] = {
            localMessageType: recordHeader.localMessageType,
            globalMessageNumber,
            fields,
            developerFields: recordHeader.developerData ? devFields : undefined,
          };

          pointer = nextPointer;
        } else {
          // Parse Data Record
          const recordTemplate = localMessageDefinitions[recordHeader.localMessageType];
          if (!recordTemplate) {
            pointer++;
            continue;
          }

          let recordPointer = pointer + 1;
          const globalMsgNum = recordTemplate.globalMessageNumber;

          // Parse fields
          let lat: number | undefined;
          let lng: number | undefined;
          let altitude: number | undefined;
          let enhancedAltitude: number | undefined;
          let time: Date | undefined;
          let power: number | undefined;
          let hr: number | undefined;
          let cad: number | undefined;
          let temp: number | undefined;
          let speed: number | undefined;
          let enhancedSpeed: number | undefined;

          // Temp values for metadata
          let metaManufacturer: string | undefined;
          let metaProduct: string | undefined;
          let metaSerial: string | undefined;
          let metaSoftware: string | undefined;
          let metaSport: string | undefined;
          let metaTotalTime: number | undefined;
          let metaTotalDist: number | undefined;
          let metaComment: string | undefined;

          const decodedData: Record<string, any> = {};

          for (const field of recordTemplate.fields) {
            const val = readDataField(field.baseType, fit, recordPointer, field.size, littleEndian);
            recordPointer += field.size;

            if (val !== undefined && val !== null) {
              const nameMap = FIELD_NAMES[globalMsgNum];
              const fieldName = nameMap && nameMap[field.recordNumber] !== undefined ? nameMap[field.recordNumber] : `field_${field.recordNumber}`;
              
              let decodedVal = val;
              
              // 1. Convert semicircles to degrees for position fields
              if (fieldName.endsWith('_lat') || fieldName.endsWith('_long') || fieldName.endsWith('_latitude') || fieldName.endsWith('_longitude') || fieldName === 'start_position_lat' || fieldName === 'start_position_long' || fieldName === 'end_position_lat' || fieldName === 'end_position_long') {
                if (typeof val === 'number' && Math.abs(val) > 180) {
                  decodedVal = val * (180 / Math.pow(2, 31));
                }
              }
              
              // 2. Decode manufacturer id to string name
              if (fieldName === 'manufacturer') {
                const mId = Number(val);
                if (!isNaN(mId) && MANUFACTURER_MAP[mId]) {
                  decodedVal = `${MANUFACTURER_MAP[mId]} (${mId})`;
                }
              }

              // 3. Decode product id to string name
              if (fieldName === 'product' || fieldName === 'garmin_product') {
                const pId = Number(val);
                if (!isNaN(pId) && PRODUCT_MAP[pId]) {
                  decodedVal = `${PRODUCT_MAP[pId]} (${pId})`;
                }
              }

              // 4. Translate fields using ENUM_MAPS from Profile.csv
              if (ENUM_MAPS[fieldName]) {
                const enumVal = Number(val);
                if (!isNaN(enumVal) && ENUM_MAPS[fieldName][enumVal] !== undefined) {
                  decodedVal = `${ENUM_MAPS[fieldName][enumVal]} (${enumVal})`;
                }
              }
              
              // 5. Format timestamp to Date string or Date object
              if (field.recordNumber === 253 || fieldName === 'start_time' || fieldName === 'time_created' || fieldName === 'local_timestamp') {
                if (typeof val === 'number') {
                  decodedVal = new Date((val + 631065600) * 1000);
                }
              }

              decodedData[fieldName] = decodedVal;
            }

            if (field.recordNumber === 253) {
              if (typeof val === 'number') {
                latestTimestamp = val;
                time = new Date((val + 631065600) * 1000);
              }
            }

            if (globalMsgNum === 20) {
              // record
              if (field.recordNumber === 0) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  lat = numVal;
                }
              } else if (field.recordNumber === 1) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  lng = numVal;
                }
              } else if (field.recordNumber === 2) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  altitude = numVal;
                }
              } else if (field.recordNumber === 78) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  enhancedAltitude = numVal;
                }
              } else if (field.recordNumber === 7) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  power = numVal;
                }
              } else if (field.recordNumber === 3) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  hr = numVal;
                }
              } else if (field.recordNumber === 4) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  cad = numVal;
                }
              } else if (field.recordNumber === 13) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  temp = numVal;
                }
              } else if (field.recordNumber === 6) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  speed = numVal;
                }
              } else if (field.recordNumber === 73) {
                const numVal = Number(val);
                if (val !== undefined && val !== null && !isNaN(numVal)) {
                  enhancedSpeed = numVal;
                }
              }
            } else if (globalMsgNum === 0) {
              // file_id
              if (field.recordNumber === 3) metaManufacturer = String(val);
              else if (field.recordNumber === 4) metaProduct = String(val);
              else if (field.recordNumber === 1) metaSerial = String(val);
            } else if (globalMsgNum === 23) {
              // device_info
              if (field.recordNumber === 2) metaManufacturer = String(val);
              else if (field.recordNumber === 4) metaProduct = String(val);
              else if (field.recordNumber === 3) metaSerial = String(val);
              else if (field.recordNumber === 5) metaSoftware = String(val);
            } else if (globalMsgNum === 12) {
              // sport
              if (field.recordNumber === 0 || field.recordNumber === 3) metaSport = String(val);
            } else if (globalMsgNum === 31) {
              // course
              if (field.recordNumber === 5) fitName = String(val).trim();
            } else if (globalMsgNum === 26) {
              // workout
              if (field.recordNumber === 6 || field.recordNumber === 8) fitName = String(val).trim();
            } else if (globalMsgNum === 18) {
              // session
              if (field.recordNumber === 8) metaTotalTime = parseFloat(val);
              else if (field.recordNumber === 9) metaTotalDist = parseFloat(val);
              else if (field.recordNumber === 28) {
                const sName = String(val).trim();
                if (sName && !/session\s+\d+/i.test(sName)) fitName = sName;
              } else if (field.recordNumber === 83) {
                const sName = String(val).trim();
                if (sName) fitName = sName;
              } else if (field.recordNumber === 29 || field.recordNumber === 30 || field.recordNumber === 110) {
                metaComment = String(val).trim();
              }
            } else if (globalMsgNum === 34) {
              // activity
              if (field.recordNumber === 1 || field.recordNumber === 2) {
                const aName = String(val).trim();
                if (aName && !/activity/i.test(aName)) fitName = aName;
              } else if (field.recordNumber === 11) {
                const aName = String(val).trim();
                if (aName) fitName = aName;
              } else if (field.recordNumber === 3 || field.recordNumber === 4 || field.recordNumber === 12) {
                metaComment = String(val).trim();
              }
            }

            // General smart scanner for strings in meta messages
            if (field.baseType === 0x07 && val && typeof val === 'string' && val.trim().length > 0) {
              const strVal = val.trim();
              const isGeneric = /^(activity|session|course|workout|unnamed|unknown|0|\d+)$/i.test(strVal);
              if (!isGeneric && (globalMsgNum === 18 || globalMsgNum === 34 || globalMsgNum === 31 || globalMsgNum === 26 || globalMsgNum === 140)) {
                if (strVal.length > 45 || (strVal.includes(' ') && strVal.length > 15)) {
                  if (!fitNotes) fitNotes = strVal;
                } else if (strVal.length > 3 && strVal.length < 40) {
                  if (!fitName) fitName = strVal;
                }
              }
            }
          }

          if (recordTemplate.developerFields) {
            for (const devField of recordTemplate.developerFields) {
              recordPointer += devField.size;
            }
          }

          if (recordHeader.headerType === 'COMPRESSED') {
            let realTimestamp = (latestTimestamp & 0xFFFFFFE0) + recordHeader.timestampOffset;
            if (recordHeader.timestampOffset < (latestTimestamp & 0x0000001F)) {
              realTimestamp += 0x20;
            }
            time = new Date((realTimestamp + 631065600) * 1000);
          }

          // Save trackpoint if position is valid
          if (globalMsgNum === 20 && lat !== undefined && lng !== undefined) {
            // Convert semicircles to degrees if necessary
            if (Math.abs(lat) > 180) lat = lat * (180 / Math.pow(2, 31));
            if (Math.abs(lng) > 180) lng = lng * (180 / Math.pow(2, 31));

            if (Math.abs(lat - 180) > 0.0001 && Math.abs(lng - 180) > 0.0001) {
              // CRITICAL: FIT SDK Altitude and Enhanced Altitude both use a scale of 5 and offset of 500 meters.
              // Formula: decodedValue = (rawValue / 5) - 500. DO NOT CHANGE THIS TO 3000!
              // Changing this to / 3000 will result in flat/zero elevation statistics for Garmin FIT files.
              let ele: number | undefined;
              if (enhancedAltitude !== undefined && enhancedAltitude !== null && !isNaN(enhancedAltitude) && enhancedAltitude !== 4294967295) {
                ele = enhancedAltitude / 5 - 500;
              }
              if ((ele === undefined || ele === null || isNaN(ele)) && altitude !== undefined && altitude !== null && !isNaN(altitude) && altitude !== 65535) {
                ele = altitude / 5 - 500;
              }
              
              let pointTime = time;
              if (!pointTime && latestTimestamp !== undefined) {
                pointTime = new Date((latestTimestamp + 631065600) * 1000);
              }
              
              let pointSpeed: number | undefined = undefined;
              if (enhancedSpeed !== undefined && enhancedSpeed !== null && !isNaN(enhancedSpeed) && enhancedSpeed !== 4294967295) {
                pointSpeed = enhancedSpeed / 3000;
              } else if (speed !== undefined && speed !== null && !isNaN(speed) && speed !== 65535) {
                pointSpeed = speed / 1000;
              }

              points.push({ lat, lng, ele, time: pointTime, power, hr, cadence: cad, temp, speed: pointSpeed });
            }
          }

          // Process meta values
          if (globalMsgNum === 0 || globalMsgNum === 23) {
            if (metaManufacturer) deviceManufacturer = getManufacturerName(metaManufacturer);
            if (metaProduct) deviceModel = getProductModelName(metaProduct);
            if (metaSerial) serialNumber = metaSerial;
            if (metaSoftware) softwareVersion = metaSoftware;
          } else if (globalMsgNum === 12) {
            if (metaSport) sportName = getSportLabel(metaSport);
          } else if (globalMsgNum === 18) {
            if (metaTotalTime !== undefined) sessionDuration = metaTotalTime;
            if (metaTotalDist !== undefined) sessionDistance = metaTotalDist;
            if (metaComment) fitNotes = metaComment;
          } else if (globalMsgNum === 34) {
            if (metaComment) fitNotes = metaComment;
          } else if (globalMsgNum === 19) {
            lapCount++;
          }

          if (globalMsgNum !== 20 && rawRecordsForMeta.length < 350) {
            rawRecordsForMeta.push({
              type: getMessageName(globalMsgNum),
              data: decodedData
            });
          }

          pointer = recordPointer;
        }
      }

      pointer += 2; // skip CRC
    }

    const sanitizedPoints = sanitizeGPXPoints(points);

    if (sanitizedPoints.length === 0) {
      console.error("FIT parsing error: No valid position records found");
      return null;
    }

    // Validate elevation data existence and provide a meaningful default if missing
    const hasElevation = sanitizedPoints.some(p => p.ele !== undefined && p.ele !== null && !isNaN(p.ele));
    if (!hasElevation) {
      console.warn(`No elevation/altitude data found in FIT file "${fileName}". Generating a flat 0m baseline as default.`);
      for (const p of sanitizedPoints) {
        p.ele = 0;
      }
    } else {
      // Smoothly fill/interpolate any scattered missing elevation values
      let lastValidEle = sanitizedPoints.find(p => p.ele !== undefined && p.ele !== null && !isNaN(p.ele))?.ele || 0;
      for (let i = 0; i < sanitizedPoints.length; i++) {
        const p = sanitizedPoints[i];
        if (p.ele === undefined || p.ele === null || isNaN(p.ele)) {
          p.ele = lastValidEle;
        } else {
          lastValidEle = p.ele;
        }
      }
    }

    if (fitName) {
      const lower = fitName.toLowerCase();
      if (lower === 'activity' || lower === 'course' || lower === 'unnamed' || lower === 'workout' || lower === '0') {
        fitName = undefined;
      }
    }

    let name = '';
    if (fitName) {
      name = fitName;
    } else {
      const firstPoint = sanitizedPoints.find(p => p.time !== undefined) || sanitizedPoints[0];
      const startDate = firstPoint?.time || new Date();
      const dateStr = startDate.toLocaleDateString('de-DE', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      const timeStr = startDate.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      name = `${dateStr}, ${timeStr}`;
      if (firstPoint?.lat !== undefined && firstPoint?.lng !== undefined) {
        const location = await getLocationName(firstPoint.lat, firstPoint.lng);
        name += ` (${location})`;
      } else {
        name += ` - ${fileName.replace(/\.[^/.]+$/, "")}`;
      }
    }

    const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(sanitizedPoints);
    const activityType = detectActivityType(sanitizedPoints, name, fileName);
    const powerStats = calculatePowerStats(sanitizedPoints, 250, 75, 15, activityType);
    const realSurfaceStats = calculateSurfaceStatsFromPoints(sanitizedPoints);
    const surfaceStats = realSurfaceStats.length > 0 
      ? realSurfaceStats 
      : generateMockSurfaceStats(totalDist, name, activityType);
    hydratePointsWithSurface(sanitizedPoints, surfaceStats, totalDist);
    const climbs = findClimbs(sanitizedPoints);
    
    let duration: number | undefined;
    const hasTimestamps = sanitizedPoints.some(p => p.time !== undefined);
    if (hasTimestamps && sanitizedPoints.length > 1) {
      const firstTime = sanitizedPoints.find(p => p.time !== undefined)?.time;
      const lastTime = [...sanitizedPoints].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        duration = (lastTime.getTime() - firstTime.getTime()) / 1000;
      }
    }

    const color = HIGH_CONTRAST_COLORS[colorIndex % HIGH_CONTRAST_COLORS.length];
    colorIndex++;

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `fit-${Date.now()}-${Math.random()}`,
      name,
      points: sanitizedPoints,
      color,
      distance: totalDist,
      ascent,
      descent,
      maxSlope,
      visible: true,
      activityType,
      powerStats,
      surfaceStats,
      duration,
      hasTimestamps,
      climbs,
      description: fitNotes || "",
      rawFileDetails: {
        fileType: 'fit',
        fileName,
        metadata: {
          deviceManufacturer,
          deviceModel,
          serialNumber,
          softwareVersion,
          sportName,
          sessionDuration,
          sessionDistance,
          lapCount,
          rawRecords: rawRecordsForMeta
        }
      }
    };
  } catch (error) {
    console.error("Error parsing FIT:", error);
    return null;
  }
};
