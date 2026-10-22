import type { Rng } from "./rng.js";

/**
 * Joueurs fictifs du circuit de carrière. Les noms sont générés à partir de prénoms et de noms
 * courants de chaque pays ; les noms de famille des joueurs professionnels connus sont écartés des
 * listes, et une liste de noms réels sert de garde-fou : aucun bot ne porte le nom d'un vrai joueur
 * (ni ne se voit attribuer un niveau qui n'est pas le sien). Les noms restent modifiables.
 */

export interface Country {
  code: string;
  name: string;
  flag: string;
  first: string[];
  last: string[];
  /** Poids dans le circuit professionnel (proportion approximative de joueurs). */
  weight: number;
}

export const COUNTRIES: Country[] = [
  {
    code: "ENG",
    name: "Angleterre",
    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    weight: 30,
    first: ["Jack", "Harry", "Tom", "Callum", "Liam", "Dean", "Lee", "Craig", "Wayne", "Shaun", "Kyle", "Jordan", "Mark", "Scott", "Darren", "Jamie", "Ben", "Connor", "Reece", "Alfie", "Ashley", "Stuart", "Karl", "Glen", "Neil", "Ollie", "Danny", "Sam"],
    last: ["Hartley", "Pennington", "Thornton", "Crowther", "Blakemore", "Ashworth", "Whitlock", "Fairbrother", "Radcliffe", "Hollis", "Mercer", "Lambeth", "Kingsley", "Brightwell", "Holloway", "Ainsworth", "Sutcliffe", "Barraclough", "Fenwick", "Oakley", "Rowntree", "Haddon", "Pickering", "Stanwick", "Gresley", "Marsden", "Hebden", "Copeland", "Ridley", "Tolworth"],
  },
  {
    code: "NED",
    name: "Pays-Bas",
    flag: "🇳🇱",
    weight: 14,
    first: ["Jeroen", "Sander", "Niels", "Bas", "Thijs", "Ruben", "Joost", "Wouter", "Stijn", "Rick", "Daan", "Martijn", "Mitchell", "Jesse", "Luuk"],
    last: ["van Dalen", "de Groot", "Verhoeven", "Bakker", "van Leeuwen", "Smit", "Kuipers", "van der Linde", "Hendriks", "Mulder", "de Wit", "Brouwer", "Postma", "van Rijn", "Hoekstra", "Dekker"],
  },
  {
    code: "GER",
    name: "Allemagne",
    flag: "🇩🇪",
    weight: 8,
    first: ["Lukas", "Jonas", "Florian", "Tobias", "Maximilian", "Niklas", "Sebastian", "Dominik", "Marcel", "Kai", "Timo", "Steffen"],
    last: ["Becker", "Hoffmann", "Krüger", "Schäfer", "Wagner", "Neumann", "Zimmermann", "Hartmann", "Braun", "Vogel", "Lehmann", "Kaiser"],
  },
  {
    code: "SCO",
    name: "Écosse",
    flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    weight: 6,
    first: ["Ewan", "Fraser", "Callum", "Ross", "Euan", "Alistair", "Gregor", "Kenny", "Iain", "Blair", "Hamish"],
    last: ["McKinlay", "Drummond", "Strachan", "Galbraith", "McAllister", "Buchanan", "Lennox", "Murdoch", "Cairns", "Kirkland", "MacLeod", "Forsyth"],
  },
  {
    code: "WAL",
    name: "Pays de Galles",
    flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    weight: 5,
    first: ["Rhys", "Dafydd", "Gethin", "Owain", "Gareth", "Aled", "Huw", "Ieuan", "Carwyn", "Emyr"],
    last: ["Pritchard", "Llewellyn", "Bevan", "Prosser", "Vaughan", "Gwynne", "Rowlands", "Meredith", "Tudor", "Pugh"],
  },
  {
    code: "BEL",
    name: "Belgique",
    flag: "🇧🇪",
    weight: 5,
    first: ["Jens", "Wout", "Pieter", "Dries", "Sven", "Brecht", "Joris", "Tom"],
    last: ["Peeters", "Janssens", "Maes", "Claes", "Willems", "Goossens", "Wouters", "De Smet", "Vermeulen", "Lambrechts"],
  },
  {
    code: "NIR",
    name: "Irlande du Nord",
    flag: "🇬🇧",
    weight: 3,
    first: ["Ciaran", "Declan", "Niall", "Conor", "Paddy", "Gareth"],
    last: ["MacAuley", "Doherty", "Quinn", "McGarvey", "Devlin", "Hegarty"],
  },
  {
    code: "IRL",
    name: "Irlande",
    flag: "🇮🇪",
    weight: 3,
    first: ["Sean", "Eoin", "Cathal", "Darragh", "Fionn", "Ronan", "Tadhg"],
    last: ["O'Driscoll", "Kavanagh", "Brennan", "Fitzgerald", "Mulligan", "Donnelly", "Fennelly"],
  },
  {
    code: "AUS",
    name: "Australie",
    flag: "🇦🇺",
    weight: 4,
    first: ["Brody", "Lachlan", "Mitch", "Jaxon", "Corey", "Brett", "Nathan"],
    last: ["Kearney", "Pemberton", "Whitfield", "Doolan", "Halloran", "Callaghan", "Barlow"],
  },
  {
    code: "POL",
    name: "Pologne",
    flag: "🇵🇱",
    weight: 3,
    first: ["Mateusz", "Kamil", "Paweł", "Tomasz", "Jakub", "Łukasz"],
    last: ["Kowalczyk", "Wiśniewski", "Zieliński", "Szymański", "Dąbrowski", "Kaczmarek", "Mazur"],
  },
  {
    code: "AUT",
    name: "Autriche",
    flag: "🇦🇹",
    weight: 2,
    first: ["Mario", "Patrick", "Stefan", "Christoph", "Lukas"],
    last: ["Gruber", "Huber", "Pichler", "Steiner", "Moser", "Hofer"],
  },
  {
    code: "FRA",
    name: "France",
    flag: "🇫🇷",
    weight: 2,
    first: ["Julien", "Thomas", "Nicolas", "Maxime", "Kévin", "Romain", "Antoine", "Jérémy", "Florian", "Sébastien"],
    last: ["Lefebvre", "Moreau", "Girard", "Fontaine", "Rousseau", "Chevalier", "Mercier", "Garnier", "Faure", "Roux"],
  },
  { code: "POR", name: "Portugal", flag: "🇵🇹", weight: 1, first: ["Tiago", "Rui", "Nuno", "Diogo", "João"], last: ["Ferreira", "Carvalho", "Moreira", "Pinto", "Teixeira"] },
  { code: "ESP", name: "Espagne", flag: "🇪🇸", weight: 1, first: ["Javier", "Sergio", "Álvaro", "Pablo", "Iván"], last: ["Navarro", "Romero", "Delgado", "Castillo", "Ortega"] },
  { code: "SWE", name: "Suède", flag: "🇸🇪", weight: 1, first: ["Oskar", "Viktor", "Anton", "Emil", "Johan"], last: ["Lindqvist", "Bergström", "Sandberg", "Holm", "Nyström"] },
  { code: "DEN", name: "Danemark", flag: "🇩🇰", weight: 1, first: ["Mads", "Rasmus", "Kasper", "Mikkel"], last: ["Kristensen", "Mortensen", "Thomsen", "Lauridsen"] },
  { code: "LAT", name: "Lettonie", flag: "🇱🇻", weight: 1, first: ["Artūrs", "Kristaps", "Edgars"], last: ["Bērziņš", "Kalniņš", "Ozols"] },
  { code: "LTU", name: "Lituanie", flag: "🇱🇹", weight: 1, first: ["Mantas", "Tomas", "Darius"], last: ["Kazlauskas", "Petrauskas", "Jankauskas"] },
  { code: "CZE", name: "Tchéquie", flag: "🇨🇿", weight: 1, first: ["Jan", "Petr", "Ondřej"], last: ["Novák", "Dvořák", "Černý"] },
  { code: "HUN", name: "Hongrie", flag: "🇭🇺", weight: 1, first: ["Gábor", "Péter", "Zoltán"], last: ["Nagy", "Kovács", "Szabó", "Horváth"] },
  { code: "ITA", name: "Italie", flag: "🇮🇹", weight: 1, first: ["Marco", "Luca", "Davide"], last: ["Colombo", "Ricci", "Marino"] },
  { code: "NZL", name: "Nouvelle-Zélande", flag: "🇳🇿", weight: 1, first: ["Tama", "Hamish", "Blake"], last: ["Te Awa", "Whitaker", "Rangi"] },
  { code: "USA", name: "États-Unis", flag: "🇺🇸", weight: 1, first: ["Tyler", "Cody", "Brandon", "Austin"], last: ["Walker", "Brooks", "Sullivan", "Harper"] },
  { code: "CAN", name: "Canada", flag: "🇨🇦", weight: 1, first: ["Logan", "Tanner", "Ethan"], last: ["Tremblay", "Bouchard", "MacKenzie"] },
  { code: "JPN", name: "Japon", flag: "🇯🇵", weight: 1, first: ["Haruki", "Daichi", "Ren", "Kaito"], last: ["Tanaka", "Watanabe", "Kobayashi", "Nakamura"] },
  { code: "PHI", name: "Philippines", flag: "🇵🇭", weight: 1, first: ["Paolo", "Jerome", "Rafael"], last: ["Santos", "Reyes", "Dela Cruz", "Bautista"] },
  { code: "RSA", name: "Afrique du Sud", flag: "🇿🇦", weight: 1, first: ["Pieter", "Johan", "Ruan"], last: ["van Wyk", "Botha", "Pretorius", "Nel"] },
];

const NICKNAMES = [
  "The Lighthouse", "Thunderbolt", "The Viking", "Silver Arrow", "The Falcon", "Big Ben", "The Professor", "Dynamite",
  "The Comet", "The Surgeon", "The Wolf", "Le Sniper", "The Matador", "Dutch Thunder", "The Tornado", "Golden Boy",
  "The Engineer", "The Bulldozer", "The Panther", "Stormin'", "Hotshot", "The Crusher", "The Ace", "El Toro",
  "The Duke", "Slingshot", "The Prince", "The Flame", "The Owl", "Lucky Star", "The Anchor", "Black Mamba",
  "The Architect", "Firestarter", "The Gladiator", "Highlander", "The Hurricane", "The Jester", "The Lynx", "Magic Hands",
  "The Metronome", "Mr Smooth", "The Navigator", "The Phoenix", "Quickdraw", "The Raven", "Red Baron", "The Saint",
  "Sharpshooter", "The Shark", "Steel City", "The Storm", "Sundance", "The Tank", "Tick Tock", "Top Gun",
  "The Typhoon", "Velvet", "The Warrior", "Wildcard", "The Wizard", "Zorro", "Le Métronome", "The Bear",
  "The Barber", "Bolt", "The Cobra", "The Doctor", "Gentleman Jim", "The Hawk", "The Kid", "The Lion",
];

/** Garde-fou : noms de joueurs réels qu'aucun bot ne doit porter. */
const REAL_NAMES = new Set(
  [
    "Luke Littler", "Luke Humphries", "Michael van Gerwen", "Phil Taylor", "Gerwyn Price", "Michael Smith", "Peter Wright", "Gary Anderson",
    "Rob Cross", "James Wade", "Nathan Aspinall", "Stephen Bunting", "Jonny Clayton", "Danny Noppert", "Dave Chisnall", "Chris Dobey",
    "Joe Cullen", "Ryan Searle", "Damon Heta", "Josh Rock", "Daryl Gurney", "Martin Schindler", "Gian van Veen", "Mike De Decker",
    "Dimitri Van den Bergh", "Raymond van Barneveld", "Adrian Lewis", "Callan Rydz", "Ross Smith", "Andrew Gilding", "Brendan Dolan",
    "Ricardo Pietreczko", "Dirk van Duijvenbode", "Krzysztof Ratajski", "Kevin Doets", "Cameron Menzies", "Ryan Joyce", "Luke Woodhouse",
    "Martin Lukeman", "Jermaine Wattimena", "Rob Owen", "Wessel Nijman", "Gabriel Clemens", "Kim Huybrechts", "Mensur Suljovic",
    "Jose de Sousa", "Simon Whitlock", "Glen Durrant", "Scott Williams", "Mervyn King", "Steve Beaton", "Keegan Brown", "Ian White",
    "Vincent van der Voort", "Jim Williams", "Madars Razma", "Thibault Tricole", "Jacques Labre",
  ],
);

function weightedCountry(rng: Rng, pool: Country[]): Country {
  const total = pool.reduce((s, c) => s + c.weight, 0);
  let r = rng.next() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1]!;
}

export function countryOf(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/** Nom unique (prénom + nom d'un même pays), jamais celui d'un joueur réel. */
export function generateIdentity(rng: Rng, taken: Set<string>, country?: string): { name: string; nickname: string; country: string } {
  const pool = country ? COUNTRIES.filter((c) => c.code === country) : COUNTRIES;
  for (let attempt = 0; attempt < 200; attempt++) {
    const c = pool.length === 1 ? pool[0]! : weightedCountry(rng, pool);
    const name = `${rng.pick(c.first)} ${rng.pick(c.last)}`;
    if (taken.has(name.toLowerCase()) || REAL_NAMES.has(name)) continue;
    taken.add(name.toLowerCase());
    return { name, nickname: rng.pick(NICKNAMES), country: c.code };
  }
  // Pool épuisé (très improbable) : un suffixe garantit l'unicité.
  const c = pool[0]!;
  const name = `${rng.pick(c.first)} ${rng.pick(c.last)} ${taken.size}`;
  taken.add(name.toLowerCase());
  return { name, nickname: rng.pick(NICKNAMES), country: c.code };
}
