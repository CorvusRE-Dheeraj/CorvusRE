// Deploy via CLI: `supabase functions deploy zoning-lookup --no-verify-jwt`
// (anonymous visitors run the permitting wizard before they have an account).
//
// Looks up the zoning for a Texas street address from the city's own public
// zoning map. No paid data provider and no API keys:
//  1. The US Census geocoder turns the address into a point AND tells us the
//     incorporated city it really sits in (postal city names often differ
//     from city limits).
//  2. Houston has no zoning; land outside any city has no zoning either
//     (Texas counties can't zone) — both are real answers, not blanks.
//  3. Otherwise, if we know that city's zoning map service, ask it which
//     zoning district covers the point.
//
// Geocoded points sit on or near the street line, which can fall in the
// right-of-way (streets carry no zoning), so the map query widens a few
// metres at a time until it finds the parcel's district.

import { corsHeaders, jsonError, preflight } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/rate-limit.ts";

type CitySource = {
  /** Census place base name, e.g. "Frisco" */
  name: string;
  /** ArcGIS layer URL (…/MapServer/N or …/FeatureServer/N) */
  layer: string;
  /** Attribute(s) holding the district code, first non-empty wins */
  code: string[];
  /** Attribute holding a plain-English district name, if the city publishes one */
  description?: string;
  /** Attribute(s) naming a planned development / special use on the parcel */
  extras?: { field: string; label: string }[];
  /** Public map people can check it on */
  mapUrl: string;
};

// Fort Worth publishes zoning (mapit.fortworthtexas.gov), but its server refuses
// connections from cloud hosts, so it can't be read from here.
const CITIES: CitySource[] = [
  {
    name: "Dallas",
    layer:
      "https://gis.dallascityhall.com/arcgis/rest/services/sdc_public/Zoning/MapServer/15",
    code: ["LONG_ZONE_DIST", "ZONE_DIST"],
    extras: [{ field: "PD_NUM", label: "PD" }],
    mapUrl:
      "https://dallascitydev.maps.arcgis.com/apps/webappviewer/index.html",
  },
  {
    name: "Austin",
    layer:
      "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0",
    code: ["ZONING_ZTYPE", "ZONING_BASE"],
    mapUrl: "https://maps.austintexas.gov/GIS/PropertyProfile/",
  },
  {
    name: "Plano",
    layer:
      "https://maps.planogis.org/arcgiswad/rest/services/OpenData/Zoning/MapServer/0",
    code: ["ZN"],
    description: "IMS_ZONE",
    extras: [
      { field: "PD", label: "PD" },
      { field: "S", label: "Specific Use Permit" },
    ],
    mapUrl: "https://maps.planogis.org/",
  },
  {
    name: "Frisco",
    layer:
      "https://maps.friscotexas.gov/gis/rest/services/Public/External_Planning_and_Zoning/MapServer/32",
    code: ["ZONE_"],
    extras: [
      { field: "PD", label: "PD" },
      { field: "SUP", label: "Specific Use Permit" },
    ],
    mapUrl: "https://www.friscotexas.gov/1010/Interactive-Maps",
  },
  {
    name: "McKinney",
    layer:
      "https://maps.mckinneytexas.org/mckinney/rest/services/MapServices/Zoning/MapServer/0",
    code: ["ZoningType"],
    extras: [{ field: "SUP", label: "Specific Use Permit" }],
    mapUrl: "https://maps.mckinneytexas.org/",
  },
  {
    name: "Celina",
    layer:
      "https://services1.arcgis.com/x4nhme9V33KOzAfr/arcgis/rest/services/Zoning_Districts_Open_Data/FeatureServer/12",
    code: ["zoning"],
    mapUrl: "https://www.celina-tx.gov/1291/Planned-Developments",
  },
  {
    name: "Allen",
    layer: "https://gismaps.cityofallen.org/arcgis/rest/services/Current_Zoning/MapServer/0",
    code: ["Zoning"],
    mapUrl: "https://gismaps.cityofallen.org/",
  },
  {
    name: "Little Elm",
    layer:
      "https://utility.arcgis.com/usrsvcs/servers/02a5058072224440ad63102df41947ea/rest/services/LittleElmGISLayers/ZoningDistrict/FeatureServer/0",
    code: ["Type"],
    extras: [{ field: "PD_ID", label: "PD" }],
    mapUrl: "https://www.littleelm.org/",
  },
  {
    name: "Irving",
    layer:
      "https://services3.arcgis.com/OfsJXUlu8pSkbl7B/arcgis/rest/services/Zoning_Landuse/FeatureServer/5",
    code: ["BaseDistrict", "District"],
    description: "Use_",
    mapUrl: "https://www.cityofirving.org/",
  },
  {
    name: "Garland",
    layer: "https://maps2.garlandtx.gov/server1/rest/services/PLANNING/ZONING/MapServer/0",
    code: ["BASEZONING", "GDC_ZONING", "BASE_ZONE"],
    mapUrl: "https://www.garlandtx.gov/",
  },
  {
    name: "Georgetown",
    layer:
      "https://gis.georgetowntexas.gov/arcgis/rest/services/OpenData/OpenData_FeatureService/FeatureServer/5",
    code: ["ZONE"],
    description: "FULLZONE",
    mapUrl: "https://gis.georgetowntexas.gov/",
  },
  {
    name: "Pflugerville",
    layer: "https://maps.pflugervilletx.gov/arcgis/rest/services/Planning/Zoning_Districts/FeatureServer/0",
    code: ["ZOINING_TY"],
    description: "ZONING_DES",
    mapUrl: "https://maps.pflugervilletx.gov/",
  },
  {
    name: "Richardson",
    layer: "https://maps.cor.gov/arcgis/rest/services/DevelopmentServices/Zoning/MapServer/1",
    code: ["ZONECLASS"],
    description: "ZONEDESC",
    mapUrl: "https://maps.cor.gov/",
  },
  {
    name: "Lewisville",
    layer:
      "https://services2.arcgis.com/kXGqZY4GIOcEYxoF/arcgis/rest/services/Zoning_Feature_view/FeatureServer/0",
    code: ["ZONING_CLASS"],
    description: "Zoning_Desc",
    mapUrl: "https://www.cityoflewisville.com/",
  },
  {
    name: "Round Rock",
    layer: "https://maps.roundrocktexas.gov/arcgis/rest/services/Planning/Planning_Multi/MapServer/12",
    code: ["BASE_ZONIN"],
    description: "NAME",
    extras: [{ field: "PUD_LABEL", label: "PUD" }],
    mapUrl: "https://maps.roundrocktexas.gov/",
  },
  // Below: each city's own published zoning layer, checked against the
  // Census city limits (a sample of its districts falls inside that city).
  // mapUrl is the map service itself.
  {
    name: "San Antonio",
    layer: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12",
    code: ["Zoning", "Base"],
    description: "BaseDescription",
    mapUrl: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer",
  },
  {
    name: "El Paso",
    layer: "https://gis.elpasotexas.gov/dev/rest/services/Planning/Zoning/FeatureServer/0",
    code: ["LABEL", "ZONELABEL"],
    mapUrl: "https://gis.elpasotexas.gov/dev/rest/services/Planning/Zoning/FeatureServer",
  },
  {
    // TAG2023 holds the districts of the 2023 code update; TAG the older names.
    name: "Corpus Christi",
    layer: "https://services.arcgis.com/0J4ZNc4NaTguvRy0/arcgis/rest/services/OpenData/FeatureServer/48",
    code: ["TAG2023", "TAG"],
    mapUrl: "https://services.arcgis.com/0J4ZNc4NaTguvRy0/arcgis/rest/services/OpenData/FeatureServer",
  },
  {
    name: "Laredo",
    layer: "https://services3.arcgis.com/h9QEFLHkUI1SIRs7/arcgis/rest/services/OL_Zoning_Districts/FeatureServer/163",
    code: ["ZONE_CODE", "Zoning"],
    description: "DEFINITION",
    mapUrl: "https://services3.arcgis.com/h9QEFLHkUI1SIRs7/arcgis/rest/services/OL_Zoning_Districts/FeatureServer",
  },
  {
    // Notes holds the districts of the 2023 Unified Development Code.
    name: "Lubbock",
    layer: "https://services2.arcgis.com/eYXun6c1pgy8Qpta/arcgis/rest/services/NewZoning_UDC/FeatureServer/0",
    code: ["Notes", "ZoningActual"],
    description: "ZoningDist",
    mapUrl: "https://services2.arcgis.com/eYXun6c1pgy8Qpta/arcgis/rest/services/NewZoning_UDC/FeatureServer",
  },
  {
    name: "Amarillo",
    layer: "https://services6.arcgis.com/Vdk8uHgdgYx8ZqS6/arcgis/rest/services/Potential_Infill_Development_WFL1/FeatureServer/6",
    code: ["Zone_Text", "Zone_Designation"],
    mapUrl: "https://services6.arcgis.com/Vdk8uHgdgYx8ZqS6/arcgis/rest/services/Potential_Infill_Development_WFL1/FeatureServer",
  },
  {
    name: "Brownsville",
    layer: "https://services2.arcgis.com/6oaLMZEZlktbQpyi/arcgis/rest/services/Zoning_District_Boundaries_view/FeatureServer/0",
    code: ["Z_Cat"],
    description: "COMMENTS",
    mapUrl: "https://services2.arcgis.com/6oaLMZEZlktbQpyi/arcgis/rest/services/Zoning_District_Boundaries_view/FeatureServer",
  },
  {
    name: "Killeen",
    layer: "https://services6.arcgis.com/1UWmeVkkResmC9lR/arcgis/rest/services/Killeen_Zoning/FeatureServer/0",
    code: ["CODE"],
    mapUrl: "https://services6.arcgis.com/1UWmeVkkResmC9lR/arcgis/rest/services/Killeen_Zoning/FeatureServer",
  },
  {
    name: "Waco",
    layer: "https://gis.wacotx.gov/server/rest/services/PublicMap/PublicMap_Planning_and_Economical_Development/FeatureServer/1",
    code: ["ZONING"],
    mapUrl: "https://gis.wacotx.gov/server/rest/services/PublicMap/PublicMap_Planning_and_Economical_Development/FeatureServer",
  },
  {
    name: "Carrollton",
    layer: "https://maps.cityofcarrollton.com/arcserver/rest/services/Webmaps/Zoning/MapServer/132",
    code: ["Zoning"],
    extras: [{ field: "PD_Num", label: "PD" }],
    mapUrl: "https://maps.cityofcarrollton.com/arcserver/rest/services/Webmaps/Zoning/MapServer",
  },
  {
    name: "Midland",
    layer: "https://services.arcgis.com/0H6bQdxd9223gQB5/arcgis/rest/services/Zoning_Collab/FeatureServer/4",
    code: ["ZONINGCODE"],
    extras: [{ field: "PD_TYPE", label: "PD" }],
    mapUrl: "https://services.arcgis.com/0H6bQdxd9223gQB5/arcgis/rest/services/Zoning_Collab/FeatureServer",
  },
  {
    name: "Abilene",
    layer: "https://services6.arcgis.com/iBFmWI3dYPQqS1KF/arcgis/rest/services/Zoning_Districts/FeatureServer/0",
    code: ["ZoneClassification"],
    extras: [{ field: "PDD", label: "PDD" }],
    mapUrl: "https://services6.arcgis.com/iBFmWI3dYPQqS1KF/arcgis/rest/services/Zoning_Districts/FeatureServer",
  },
  {
    name: "College Station",
    layer: "https://gis.cstx.gov/csgis/rest/services/_OpenData/OpenData_PDS/MapServer/17",
    code: ["Zoning_Type"],
    description: "Description",
    mapUrl: "https://gis.cstx.gov/csgis/rest/services/_OpenData/OpenData_PDS/MapServer",
  },
  {
    name: "Sugar Land",
    layer: "https://interactivemaps.sugarlandtx.gov/512/rest/services/Planning/HomeBase/MapServer/9",
    code: ["Zone_Label", "ZONE__"],
    description: "ZONE_DEF",
    mapUrl: "https://interactivemaps.sugarlandtx.gov/512/rest/services/Planning/HomeBase/MapServer",
  },
  {
    name: "Tyler",
    layer: "https://gis.cityoftyler.net/arcgis/rest/services/Tyler_Zoning/FeatureServer/5",
    code: ["ZONECLASS"],
    description: "ZONEDESC",
    mapUrl: "https://gis.cityoftyler.net/arcgis/rest/services/Tyler_Zoning/FeatureServer",
  },
  ...[
    { name: "Edinburg", layer: "https://services7.arcgis.com/z3I4HxFCWafiHSiG/arcgis/rest/services/COE_ZONING_DISTRICTS/FeatureServer/0", code: ["CODE"], description: "DISTRICT" },
    { name: "San Angelo", layer: "https://services7.arcgis.com/FMMKUgitF67uKfgb/arcgis/rest/services/planning_p/FeatureServer/4", code: ["ZONE_CODE"], extras: [{ field: "PD_CODE", label: "PD" }] },
    { name: "Bryan", layer: "https://services6.arcgis.com/skDYeFloTW88hhip/arcgis/rest/services/City_of_Bryan_Zoning/FeatureServer/11", code: ["ZONING"], description: "ZONING_DES" },
    { name: "Kyle", layer: "https://services5.arcgis.com/Zhdeglqfvv6JnrnU/arcgis/rest/services/Jurisdiction_and_Zoning_Finder/FeatureServer/4", code: ["Z_Code"], description: "Description" },
    // Leander's districts combine use, site and architecture ("SFU-2-B"); Use_ is the use part
    { name: "Leander", layer: "https://services1.arcgis.com/L0MLvN0Ay0iEjnCT/arcgis/rest/services/EnerGov_Application_Layers/FeatureServer/4", code: ["Use_"], description: "Descr" },
    { name: "Pharr", layer: "https://services.arcgis.com/Uj8MycSVzMEzm7ey/arcgis/rest/services/Pharr_Published/FeatureServer/37", code: ["ZONE"] },
    // Baytown's code adopted January 2025
    { name: "Baytown", layer: "https://services8.arcgis.com/2iaYWEMdQLPv0ZUw/arcgis/rest/services/Zoning_Adopted_Jan25/FeatureServer/30", code: ["Zoning_Code"] },
    { name: "Missouri City", layer: "https://services2.arcgis.com/6vRbgYSxztFGZwla/arcgis/rest/services/Missouri_City_Zone_Lookup_WFL1/FeatureServer/6", code: ["ZONE_", "LABELS"], extras: [{ field: "SU_NUM", label: "SUP" }] },
    { name: "Flower Mound", layer: "https://services7.arcgis.com/6qFRqt366CpC8ZLF/arcgis/rest/services/Layers/FeatureServer/0", code: ["ZONE_CODE"] },
    { name: "Harlingen", layer: "https://services3.arcgis.com/gSCPzHZGMdbiljnH/arcgis/rest/services/City_of_Harlingen_Zoning_Map/FeatureServer/2", code: ["Zone"] },
    { name: "Mansfield", layer: "https://services8.arcgis.com/tUwpuhPn5EkXI11P/arcgis/rest/services/Basemap/FeatureServer/0", code: ["DISTRICT"] },
    { name: "San Marcos", layer: "https://services1.arcgis.com/Hug9pbs2TYetbCha/arcgis/rest/services/Zoning/FeatureServer/15", code: ["ZONECODE"] },
    { name: "Cedar Park", layer: "https://gis.cedarparktexas.gov/mapping/rest/services/VIEW/Zoning/MapServer/3", code: ["ZoningAbbrev"], description: "ZoningDescription" },
    { name: "Grapevine", layer: "https://services.arcgis.com/xSPs49inzz3yMpnd/arcgis/rest/services/Zoning/FeatureServer/0", code: ["ZONECODE"], description: "ZONEDESCRIPTION" },
    // ZONEDESC carries the PD number ("PD-56"); Zone_Code only "PD"
    { name: "DeSoto", layer: "https://services8.arcgis.com/QHqdbIhWBJLlMbGN/arcgis/rest/services/Zoning_DeSoto/FeatureServer/0", code: ["ZONEDESC", "Zone_Code"] },
    { name: "Prosper", layer: "https://services8.arcgis.com/MkUfAWaYm2SQf4Qa/arcgis/rest/services/PR6834_Zoning_02072025_Zoning_GCEdits/FeatureServer/0", code: ["ZONE_"], extras: [{ field: "PD", label: "PD" }] },
    { name: "Port Arthur", layer: "https://services1.arcgis.com/kFBW8xGuknyS8WK0/arcgis/rest/services/PA_Zoning2023_Official/FeatureServer/0", code: ["ZoneClass"] },
    { name: "Rockwall", layer: "https://utility.arcgis.com/usrsvcs/servers/8756c511cc6440f69575e43e5faa5d71/rest/services/Zoning_Layers_Pro/MapServer/8", code: ["ZONING_1"], description: "Description" },
    { name: "Burleson", layer: "https://gis.burlesontx.com/server/rest/services/Open_GIS_Data/OpenData/MapServer/2", code: ["ZONE_CLASS"] },
    { name: "Keller", layer: "https://arcgis.cityofkeller.com/arcgis/rest/services/Kellermaps/KEL_Zoning/MapServer/6", code: ["ZONINGCLASS"], extras: [{ field: "ZONINGCONDITION", label: "PD" }] },
    { name: "Hurst", layer: "https://services2.arcgis.com/DYDcFoEIJXAqmt4r/arcgis/rest/services/ZoningOpenData/FeatureServer/0", code: ["ZONING"] },
    { name: "Cedar Hill", layer: "https://services2.arcgis.com/c4jK8v4C9UDiTgJU/arcgis/rest/services/CHZoning/FeatureServer/0", code: ["ZONEDESC"] },
    { name: "Texas City", layer: "https://services7.arcgis.com/2iAOv9D7729Bn31m/arcgis/rest/services/City_Zoning_Districts_ReadOnly_view/FeatureServer/0", code: ["ZoningClassification"] },
    { name: "Sherman", layer: "https://services7.arcgis.com/iMHDvyzuG2Q2tuit/arcgis/rest/services/Zoning_Districts_view/FeatureServer/2", code: ["ZONECLASS"], description: "ZONEDESC" },
    { name: "Forney", layer: "https://arcgisint.forneytx.gov/arcgis/rest/services/Distribution/Forney_Zoning_Districts/MapServer/0", code: ["zoning"], description: "description" },
    { name: "Weslaco", layer: "https://services7.arcgis.com/9yzEIJbAp0HzkDjg/arcgis/rest/services/WESLACO_ZONING_DISTRICTS/FeatureServer/106", code: ["CODE"], description: "DISTRICT" },
    { name: "Friendswood", layer: "https://services6.arcgis.com/ghs8JYGzwZM6Zl6x/arcgis/rest/services/City_of_Friendswood_Zoning_by_Parcel/FeatureServer/4", code: ["ZONE"] },
    { name: "Hutto", layer: "https://services.arcgis.com/YZhxlqU7ABWQBGTG/arcgis/rest/services/Hutto_Zoning_Districts/FeatureServer/0", code: ["ZONING"], description: "ZONING" },
    { name: "Waxahachie", layer: "https://arcgis.waxahachie.com/arcgis/rest/services/Zoning_8262020/MapServer/1", code: ["ZONE"], description: "Z_DESC" },
    { name: "Princeton", layer: "https://services6.arcgis.com/KL1aiRJt0tw3BM7h/arcgis/rest/services/princeton_zoning_districts/FeatureServer/79", code: ["Zone"], extras: [{ field: "PD_Label", label: "PD" }] },
    { name: "Anna", layer: "https://services5.arcgis.com/DvFgDXTY4DS4ZXFx/arcgis/rest/services/Anna_Base_Data/FeatureServer/6", code: ["Zoning"] },
    { name: "Midlothian", layer: "https://maps.midlothian.tx.us/server/rest/services/Zoning20220803/FeatureServer/1", code: ["Zoning"] },
    { name: "Longview", layer: "https://services2.arcgis.com/L4ywDaHbEfVZyfpl/arcgis/rest/services/Potential_Redevelopment_Lots/FeatureServer/25", code: ["ZONING"] },
    { name: "Texarkana", layer: "https://utility.arcgis.com/usrsvcs/servers/511de09916824abbb2776321ec17d685/rest/services/TxkTXZoning/FeatureServer/3", code: ["ZONECLASS"], description: "ZONEDESC" },
    { name: "Lufkin", layer: "https://services6.arcgis.com/Cj2HGLAAprJTsy8b/arcgis/rest/services/Zoning/FeatureServer/0", code: ["ZONE_"] },
    { name: "Nacogdoches", layer: "https://services.arcgis.com/yA8uipuHzEEjGgU1/arcgis/rest/services/Planning_Sync/FeatureServer/34", code: ["zoning"] },
    { name: "Farmers Branch", layer: "https://services1.arcgis.com/rrMt0tlqg3eYOL0M/arcgis/rest/services/Zoning_public/FeatureServer/0", code: ["ZONECLASS"], description: "ZONEDESC" },
    { name: "Murphy", layer: "https://services5.arcgis.com/lt8CbgYaNuFrQ7kB/arcgis/rest/services/Murphy_Zoning/FeatureServer/4", code: ["Zone"], description: "MurphyZone" },
    { name: "Sachse", layer: "https://services6.arcgis.com/OSORr24S2Mlvyg30/arcgis/rest/services/Zoning/FeatureServer/0", code: ["TYPE", "ZONING"], description: "ZONING" },
    { name: "Fate", layer: "https://services9.arcgis.com/mIjkbg9M3daAUJvr/arcgis/rest/services/Zoning/FeatureServer/2", code: ["ZoningAbbreviation"], description: "ZoningDescription" },
    { name: "Royse City", layer: "https://services3.arcgis.com/65cjxRz7QPkb5HMT/arcgis/rest/services/Zoning/FeatureServer/0", code: ["Zone"], description: "Zoning_Description" },
    { name: "Greenville", layer: "https://services3.arcgis.com/PbnvqazCuoNZ4rzO/arcgis/rest/services/Zoning_Districts_2026/FeatureServer/25", code: ["Zoning"] },
    { name: "Granbury", layer: "https://services6.arcgis.com/wHtOhDQeUxQY5fQy/arcgis/rest/services/GranburyWebMap_ChamberOfCommerce/FeatureServer/1", code: ["Zoning"] },
    { name: "Seguin", layer: "https://gis.seguintexas.gov/arcgis/rest/services/Data_Download/Zoning_Open_Data/FeatureServer/0", code: ["zone"] },
    { name: "Boerne", layer: "https://services1.arcgis.com/IdcmpjAKMhM2YdbF/arcgis/rest/services/Boerne_Zoning/FeatureServer/0", code: ["Zoning"] },
    { name: "Kerrville", layer: "https://services1.arcgis.com/Ijqs2ihddUy84otW/arcgis/rest/services/ZoningDistrict_Current/FeatureServer/0", code: ["maplabel"], description: "currentzoning" },
    { name: "Del Rio", layer: "https://services3.arcgis.com/gzZUHSYdnFXkNy6M/arcgis/rest/services/ArcGIS_Earth_CODR/FeatureServer/5", code: ["CODE"] },
    { name: "Eagle Pass", layer: "https://services3.arcgis.com/BqkIAsYysjLDjmUf/arcgis/rest/services/Editable_Zoning/FeatureServer/0", code: ["ZONING"], description: "DESCRIPTIO" },
    { name: "Manor", layer: "https://services5.arcgis.com/L9cGEA18yPzG7Xak/arcgis/rest/services/Zoning_View/FeatureServer/22", code: ["Zoning_Code"] },
    { name: "Lakeway", layer: "https://services8.arcgis.com/Ovzem8VyXkJhfTgz/arcgis/rest/services/Zoning_Districts/FeatureServer/0", code: ["label"], description: "district_class" },
    // Bastrop zones by "place type" (P-2 Rural, P-4 Mix, PDD …) rather than classic districts
    { name: "Bastrop", layer: "https://services7.arcgis.com/qOeXJdBtGknaCJC4/arcgis/rest/services/PlaceTypesCharacterDistricts/FeatureServer/1", code: ["PlaceTypeClass"], description: "PlaceType" },
    { name: "Belton", layer: "https://services5.arcgis.com/FkDUU6xkZJTbBa9X/arcgis/rest/services/Planning/FeatureServer/6", code: ["Zoning_Abbr"], description: "Zoning" },
    { name: "Corsicana", layer: "https://services8.arcgis.com/V3MtivrTOPqThQ57/arcgis/rest/services/Zoning_Corsicana/FeatureServer/0", code: ["Zone_"], description: "Zone_Name" },
    { name: "Katy", layer: "https://services8.arcgis.com/ihZy0ZJt5Ea5u0dK/arcgis/rest/services/Planning_Map/FeatureServer/11", code: ["ZONECODE"], description: "ZONDESC" },
    { name: "Tomball", layer: "https://services2.arcgis.com/Q162lMMZLeb8KwDU/arcgis/rest/services/Current_Zoning_(Public_View)/FeatureServer/344", code: ["District_ID"], description: "District" },
  ].map((c): CitySource => ({ ...c, mapUrl: c.layer.replace(/\/\d+$/, "") })),
];

/** Cities with no zoning ordinance at all. */
const NO_ZONING_CITIES = ["Houston"];

const SEARCH_RADII_M = [0, 10, 20, 35];
const TIMEOUT_MS = 12000;

type Result =
  | {
      status: "found";
      code: string;
      description: string | null;
      extras: string[];
      nearby: string[];
      city: string;
      source: string;
      mapUrl: string;
    }
  | { status: "no_zoning"; city: string | null; reason: string }
  | { status: "not_covered"; city: string; reason: string }
  | { status: "not_found"; city: string | null; reason: string };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

type Geo = { x: number; y: number; place: string | null };

async function geocode(address: string): Promise<Geo | null> {
  const qs = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "Incorporated Places",
    format: "json",
  });
  const data = (await getJson(
    `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${qs}`,
  )) as {
    result?: {
      addressMatches?: {
        coordinates: { x: number; y: number };
        geographies?: Record<string, { BASENAME?: string }[]>;
      }[];
    };
  };
  const m = data.result?.addressMatches?.[0];
  if (!m) return null;
  const place = m.geographies?.["Incorporated Places"]?.[0]?.BASENAME ?? null;
  return { x: m.coordinates.x, y: m.coordinates.y, place };
}

const clean = (v: unknown) =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

// A district code as the city stores it, minus wrapping like "(LC)", and
// blank when it's a placeholder rather than a district ("OCL" = outside city
// limits, "Pending" = a case not yet decided, "ROW" / "UZROW" = street
// right-of-way, which the search then widens past to the parcel, "City of
// Dallas" = a neighbouring city's land, "See DP" = look at another field,
// "Overlay" = an overlay shape drawn in the same layer as the districts). A
// name with the code in brackets, "Single Family (SF-1)", gives the code.
const districtCode = (v: unknown) => {
  let c = clean(v).replace(/^\((.*)\)$/, "$1").trim();
  const named = c.match(/^(.*\s.*?)\s*\(([A-Za-z0-9][\w.\-/]*)\)$/);
  if (named) c = named[2];
  return /^(ocl|pending|u?z?row|r\.o\.w\.?|null|none|n\/a|overlay)$|^(city of|see) /i.test(c)
    ? ""
    : c;
};

/** District name without a "[City]" prefix or the repeated code: "PD   - PLANNED DEVELOPMENT" → "PLANNED DEVELOPMENT". */
function districtName(raw: string, code: string): string {
  const s = raw.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return s
    .replace(new RegExp(`^${escaped}(\\s*[-–:]\\s*|\\s+)`, "i"), "")
    .replace(new RegExp(`\\s*\\(${escaped}\\)$`, "i"), "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
}

async function queryCity(src: CitySource, g: Geo): Promise<Result | null> {
  for (const radius of SEARCH_RADII_M) {
    const qs = new URLSearchParams({
      geometry: `${g.x},${g.y}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      f: "json",
    });
    if (radius > 0) {
      qs.set("distance", String(radius));
      qs.set("units", "esriSRUnit_Meter");
    }
    type Answer = {
      features?: { attributes: Record<string, unknown> }[];
      error?: { message?: string };
      // some servers report an outage as {status:"error", messages:[…]} with a 200
      status?: string;
      messages?: string[];
    };
    let data = (await getJson(`${src.layer}/query?${qs}`)) as Answer;
    if (data.status === "error")
      throw new Error(data.messages?.join(" ") || "map server error");
    if (data.error && radius > 0) {
      // Some maps answer the exact point but refuse a distance search (Texas
      // City) — ask for a box of the same size around the point instead.
      const dLat = radius / 111_320;
      const dLon = dLat / Math.cos((g.y * Math.PI) / 180);
      qs.delete("distance");
      qs.delete("units");
      qs.set("geometry", `${g.x - dLon},${g.y - dLat},${g.x + dLon},${g.y + dLat}`);
      qs.set("geometryType", "esriGeometryEnvelope");
      data = (await getJson(`${src.layer}/query?${qs}`)) as Answer;
    }
    if (data.error) {
      if (radius > 0) break;
      throw new Error(data.error.message ?? "map query failed");
    }
    const rows = (data.features ?? []).map((f) => f.attributes);
    const codeOf = (a: Record<string, unknown>) =>
      src.code.map((k) => districtCode(a[k])).find((v) => v) ?? "";
    const coded = rows.filter((a) => codeOf(a));
    if (coded.length === 0) continue;
    // The district covering most of the search area wins; the rest are "nearby".
    const counts = new Map<string, number>();
    for (const a of coded)
      counts.set(codeOf(a), (counts.get(codeOf(a)) ?? 0) + 1);
    const [code] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const row = coded.find((a) => codeOf(a) === code)!;
    const extras = (src.extras ?? [])
      .map(({ field, label }) => {
        const v = clean(row[field]);
        // Blank-ish placeholders some cities store ("SUP000", "PD000", "PD-", "na") mean none.
        if (!v || /^(no|none|n\/?a|0)$/i.test(v) || /^[a-z]+(-|-?0+)$/i.test(v)) return "";
        return v.toUpperCase().startsWith(label.toUpperCase())
          ? v
          : `${label} ${v}`;
      })
      .filter(Boolean);
    return {
      status: "found",
      code,
      // some cities prefix the name with their own ("[Tyler] …") or repeat the code
      description: src.description
        ? districtName(clean(row[src.description]), code) || null
        : null,
      extras,
      nearby: [...counts.keys()].filter((c) => c !== code),
      city: src.name,
      source: `City of ${src.name} zoning map`,
      mapUrl: src.mapUrl,
    };
  }
  return null;
}

async function lookup(address: string): Promise<Result> {
  const g = await geocode(address);
  if (!g) {
    return {
      status: "not_found",
      city: null,
      reason:
        "We couldn't place this address on the map to look up its zoning.",
    };
  }
  if (!g.place) {
    return {
      status: "no_zoning",
      city: null,
      reason:
        "This address is outside any city's limits. Texas counties don't zone land, so there is no zoning district — but a nearby city's extraterritorial jurisdiction (ETJ) may still apply its subdivision rules.",
    };
  }
  if (NO_ZONING_CITIES.includes(g.place)) {
    return {
      status: "no_zoning",
      city: g.place,
      reason: `${g.place} has no zoning ordinance. Land use is governed by deed restrictions and the city's development rules instead.`,
    };
  }
  const src = CITIES.find(
    (c) => c.name.toLowerCase() === g.place!.toLowerCase(),
  );
  if (!src) {
    return {
      status: "not_covered",
      city: g.place,
      reason: `We don't read the City of ${g.place}'s zoning map yet — confirm the zoning with its planning department.`,
    };
  }
  try {
    const hit = await queryCity(src, g);
    if (hit) return hit;
    return {
      status: "not_found",
      city: src.name,
      reason: `The City of ${src.name}'s zoning map has no district at this address.`,
    };
  } catch (err) {
    console.error(`zoning-lookup ${src.name}:`, err);
    return {
      status: "not_found",
      city: src.name,
      reason: `The City of ${src.name}'s zoning map didn't respond — try again, or confirm with its planning department.`,
    };
  }
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  // Per-caller limit (public endpoint; see _shared/rate-limit.ts).
  const limited = await rateLimit(req, "zoning-lookup", 60, corsHeaders);
  if (limited) return limited;
  if (req.method !== "POST") return jsonError("POST only", 405);
  let address = "";
  try {
    const body = (await req.json()) as { address?: unknown };
    address =
      typeof body.address === "string" ? body.address.trim().slice(0, 300) : "";
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (address.length < 6) return jsonError("address is required", 400);
  try {
    return new Response(JSON.stringify(await lookup(address)), {
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("zoning-lookup failed:", err);
    return new Response(
      JSON.stringify({
        status: "not_found",
        city: null,
        reason: "The zoning lookup service is unavailable right now.",
      }),
      { headers: corsHeaders },
    );
  }
});
