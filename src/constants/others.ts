const others = [
  {
    name: 'BRINIZA Oliwa z Liwek 500 ml',
    description:
      'Wysokiej jakości oliwa z liwek, idealna do sałatek i gotowania.',
    price: 49.0,
    category: 'inne',
    stock_quantity: 50,
  },
  {
    name: 'BRINIZA Oliwa z Oliwek 3 lt',
    description:
      'Duża butelka oliwy z oliwek, doskonała do codziennego użytku w kuchni.',
    price: 220.0,
    category: 'inne',
    stock_quantity: 30,
  },
  {
    name: 'BRINIZA Oliwa z Oliwek 5 lt',
    description:
      'Ekstra duża butelka oliwy z oliwek, idealna dla dużych rodzin i restauracji.',
    price: 320.0,
    category: 'inne',
    stock_quantity: 20,
  },
  {
    name: 'BRINIZA Oliwa z Oliwek 750 ml',
    description:
      'Butelka oliwy z oliwek o pojemności 750 ml, doskonała do smażenia i sałatek.',
    price: 69.0,
    category: 'inne',
    stock_quantity: 40,
  },
  {
    name: 'BRINZA Oliwa z Olwek 500 ml puszka',
    description: 'Oliwa z oliwek w praktycznej puszce, idealna na prezent.',
    price: 35.0,
    category: 'inne',
    stock_quantity: 60,
  },
  {
    name: 'Herbata górska Gojnik',
    description:
      'Aromatyczna herbata górska z liści gojnika, doskonała na chłodne wieczory.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 80,
  },
  {
    name: 'Liść Laurowy',
    description: 'Suszone liście laurowe, niezbędne w każdej kuchni.',
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
  },
  {
    name: 'Miód Dębowy',
    description: 'Naturalny miód dębowy o intensywnym smaku i aromacie.',
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
  },
  {
    name: 'Miód Kwiatowy',
    description: 'Delikatny miód kwiatowy, idealny do herbaty i wypieków.',
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
  },
  {
    name: 'Miód Sosnowy',
    description: 'Unikalny miód sosnowy o świeżym, leśnym aromacie.',
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
  },
  {
    name: 'Ocet Balsamiczny',
    description:
      'Wysokiej jakości ocet balsamiczny, doskonały do sałatek i marynat.',
    price: 15.0,
    category: 'inne',
    stock_quantity: 50,
  },
  {
    name: 'Ocet balsamiczny z miodem',
    description:
      'Ocet balsamiczny wzbogacony o naturalny miód, idealny do sosów i marynat.',
    price: 16.0,
    category: 'inne',
    stock_quantity: 45,
  },
  {
    name: 'Ocet biały winogronowy',
    description:
      'Lekki ocet winogronowy, idealny do delikatnych potraw i sałatek.',
    price: 8.5,
    category: 'inne',
    stock_quantity: 60,
  },
  {
    name: 'Ocet czerwony winogronowy',
    description:
      'Ocet winogronowy o głębokim, bogatym smaku, doskonały do mięs i warzyw.',
    price: 8.0,
    category: 'inne',
    stock_quantity: 60,
  },
  {
    name: 'Ocet winny z bazylią',
    description:
      'Aromatyczny ocet winny z dodatkiem świeżej bazylii, idealny do sałatek.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
  },
  {
    name: 'Ocet winny z czosnkiem',
    description:
      'Intensywny ocet winny z dodatkiem czosnku, doskonały do marynat.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
  },
  {
    name: 'Ocet winny z estragonem',
    description:
      'Ocet winny wzbogacony o aromatyczny estragon, idealny do potraw mięsnych.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
  },
  {
    name: 'Ocet winny z oregano',
    description:
      'Ocet winny z dodatkiem oregano, doskonały do sosów i sałatek.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
  },
  {
    name: 'Ocet winny z rozmarynem',
    description: 'Ocet winny wzbogacony o świeży rozmaryn, idealny do marynat.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
  },
  {
    name: 'Ocet winogronowy biały',
    description:
      'Łagodny ocet winogronowy, doskonały do lekkich potraw i sałatek.',
    price: 6.0,
    category: 'inne',
    stock_quantity: 70,
  },
  {
    name: 'Ocet winogronowy czerwony',
    description: 'Bogaty ocet winogronowy, idealny do intensywnych potraw.',
    price: 6.0,
    category: 'inne',
    stock_quantity: 70,
  },
  {
    name: 'Oliwki Kalamon',
    description: 'Klasyczne oliwki Kalamon o głębokim, wyrazistym smaku.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oliwki Kalamon',
    description:
      'Klasyczne oliwki Kalamon w mniejszym opakowaniu, idealne do przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
  },
  {
    name: 'Oliwki marynowane',
    description: 'Aromatyczne oliwki marynowane w ziołach i przyprawach.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
  },
  {
    name: 'Oliwki mix',
    description: 'Mieszanka różnych oliwek, idealna do sałatek i przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
  },
  {
    name: 'Oliwki z czosnkiem',
    description:
      'Oliwki wzbogacone o aromatyczny czosnek, doskonałe do przekąsek.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oliwki z migdałami',
    description: 'Oliwki nadziewane migdałami, idealne do sałatek i przekąsek.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oliwki z papryką naturalną',
    description:
      'Oliwki z dodatkiem naturalnej papryki, doskonałe do przekąsek.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oliwki z papryką piri-piri',
    description: 'Pikantne oliwki z dodatkiem ostrej papryki piri-piri.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oliwki zielone',
    description: 'Klasyczne zielone oliwki, doskonałe do sałatek i przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
  },
  {
    name: 'Oliwki zielone drylowane',
    description: 'Drylowane zielone oliwki, idealne do gotowania i sałatek.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oliwki zielone z oregano',
    description:
      'Oliwki zielone z dodatkiem świeżego oregano, doskonałe do przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
  },
  {
    name: 'Oliwki zielone z pestką',
    description: 'Zielone oliwki z pestką, idealne do przekąsek i gotowania.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
  },
  {
    name: 'Oregano Górskie',
    description:
      'Aromatyczne górskie oregano, idealne do przyprawiania potraw.',
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
  },
  {
    name: 'Rozmaryn',
    description: 'Świeży rozmaryn, doskonały do mięs i pieczeni.',
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
  },
  {
    name: 'Rumianek',
    description: 'Naturalny rumianek, idealny do parzenia herbat i naparów.',
    price: 8.5,
    category: 'inne',
    stock_quantity: 80,
  },
  {
    name: 'Ser Feta',
    description:
      'Tradycyjny ser feta, doskonały do sałatek greckich i innych potraw.',
    price: 70.0,
    category: 'inne',
    stock_quantity: 40,
  },
  {
    name: 'Ser Feta taper 400 gr',
    description:
      'Porcjowany ser feta w praktycznym opakowaniu, idealny na przekąski.',
    price: 35.0,
    category: 'inne',
    stock_quantity: 50,
  },
  {
    name: 'Tahini',
    description: 'Gładka pasta sezamowa, doskonała do hummusu i innych potraw.',
    price: 28.0,
    category: 'inne',
    stock_quantity: 60,
  },
  {
    name: 'TAHINI BIO',
    description: 'Organiczna pasta sezamowa, idealna dla zdrowej kuchni.',
    price: 19.5,
    category: 'inne',
    stock_quantity: 50,
  },
  {
    name: 'TAHINI PEŁNOZIARNISTE',
    description:
      'Pełnoziarnista pasta sezamowa, bogata w błonnik i składniki odżywcze.',
    price: 28.0,
    category: 'inne',
    stock_quantity: 60,
  },
  {
    name: 'Tahini pomarańczowe',
    description:
      'Pasta sezamowa z dodatkiem pomarańczy, doskonała do deserów i potraw orientalnych.',
    price: 28.0,
    category: 'inne',
    stock_quantity: 60,
  },
  {
    name: 'TAHINI Z PREBIOTYKAMI',
    description:
      'Pasta sezamowa wzbogacona o prebiotyki, idealna dla zdrowia jelit.',
    price: 18.9,
    category: 'inne',
    stock_quantity: 50,
  },
];

export default others;
