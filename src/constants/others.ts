const others = [
  {
    name: 'BRINIZA Oliwa z Oliwek 500 ml',
    description:
      'Wysokiej jakości oliwa z liwek, idealna do sałatek i gotowania.',
    price: 49.0,
    category: 'inne',
    stock_quantity: 50,
    image: 'uploads/oliwazoliwek.png',
  },
  {
    name: 'BRINIZA Oliwa z Oliwek 3 lt',
    description:
      'Duża butelka oliwy z oliwek, doskonała do codziennego użytku w kuchni.',
    price: 220.0,
    category: 'inne',
    stock_quantity: 30,
    image: 'uploads/oliwazliwek.png',
  },
  {
    name: 'BRINIZA Oliwa z Oliwek 5 lt',
    description:
      'Ekstra duża butelka oliwy z oliwek, idealna dla dużych rodzin i restauracji.',
    price: 320.0,
    category: 'inne',
    stock_quantity: 20,
    image: 'uploads/oliwazliwek.png',
  },
  {
    name: 'BRINIZA Oliwa z Oliwek 750 ml',
    description:
      'Butelka oliwy z oliwek o pojemności 750 ml, doskonała do smażenia i sałatek.',
    price: 69.0,
    category: 'inne',
    stock_quantity: 40,
    image: 'uploads/oliwa750.png',
  },
  {
    name: 'Herbata górska Gojnik',
    description:
      'Aromatyczna herbata górska z liści gojnika, doskonała na chłodne wieczory.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 80,
    image: 'uploads/herbata.jpeg',
  },
  {
    name: 'Liść Laurowy',
    description: 'Suszone liście laurowe, niezbędne w każdej kuchni.',
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
    image: 'uploads/lisclaurowy.jpeg',
  },
  {
    name: 'Miód Dębowy',
    description: 'Naturalny miód dębowy o intensywnym smaku i aromacie.',
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
    image: 'uploads/miod.png',
  },
  {
    name: 'Miód Kwiatowy',
    description: 'Delikatny miód kwiatowy, idealny do herbaty i wypieków.',
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
    image: 'uploads/miod.png',
  },
  {
    name: 'Miód Sosnowy',
    description: 'Unikalny miód sosnowy o świeżym, leśnym aromacie.',
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
    image: 'uploads/miod.png',
  },
  {
    name: 'Ocet Balsamiczny',
    description:
      'Wysokiej jakości ocet balsamiczny, doskonały do sałatek i marynat.',
    price: 15.0,
    category: 'inne',
    stock_quantity: 50,
    image: 'uploads/ocet.jpeg',
  },
  {
    name: 'Ocet balsamiczny z miodem',
    description:
      'Ocet balsamiczny wzbogacony o naturalny miód, idealny do sosów i marynat.',
    price: 16.0,
    category: 'inne',
    stock_quantity: 45,
    image: 'uploads/ocet1.jpeg',
  },
  {
    name: 'Ocet biały winogronowy',
    description:
      'Lekki ocet winogronowy, idealny do delikatnych potraw i sałatek.',
    price: 8.5,
    category: 'inne',
    stock_quantity: 60,
    image: 'uploads/ocet2.jpeg',
  },
  {
    name: 'Ocet czerwony winogronowy',
    description:
      'Ocet winogronowy o głębokim, bogatym smaku, doskonały do mięs i warzyw.',
    price: 8.0,
    category: 'inne',
    stock_quantity: 60,
    image: 'uploads/ocet3.jpeg',
  },
  {
    name: 'Ocet winny z bazylią',
    description:
      'Aromatyczny ocet winny z dodatkiem świeżej bazylii, idealny do sałatek.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
    image: 'uploads/ocet.jpeg',
  },
  {
    name: 'Ocet winny z czosnkiem',
    description:
      'Intensywny ocet winny z dodatkiem czosnku, doskonały do marynat.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
    image: 'uploads/ocet1.jpeg',
  },
  {
    name: 'Ocet winny z estragonem',
    description:
      'Ocet winny wzbogacony o aromatyczny estragon, idealny do potraw mięsnych.',
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
    image: 'uploads/ocet2.jpeg',
  },
  {
    name: 'Oliwki Kalamon',
    description:
      'Klasyczne oliwki Kalamon w mniejszym opakowaniu, idealne do przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwki.jpg',
  },
  {
    name: 'Oliwki marynowane',
    description: 'Aromatyczne oliwki marynowane w ziołach i przyprawach.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwkimarynowane.png',
  },
  {
    name: 'Oliwki mix',
    description: 'Mieszanka różnych oliwek, idealna do sałatek i przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwki1.jpg',
  },
  {
    name: 'Oliwki z czosnkiem',
    description:
      'Oliwki wzbogacone o aromatyczny czosnek, doskonałe do przekąsek.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
    image: 'uploads/oliwki2.jpeg',
  },
  {
    name: 'Oliwki zielone',
    description: 'Klasyczne zielone oliwki, doskonałe do sałatek i przekąsek.',
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwki.png',
  },
  {
    name: 'Oliwki zielone drylowane',
    description: 'Drylowane zielone oliwki, idealne do gotowania i sałatek.',
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
    image: 'uploads/oliwki.jpg',
  },
  {
    name: 'Oregano Górskie',
    description:
      'Aromatyczne górskie oregano, idealne do przyprawiania potraw.',
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
    image: 'uploads/oregano.jpg',
  },
  {
    name: 'Rozmaryn',
    description: 'Świeży rozmaryn, doskonały do mięs i pieczeni.',
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
    image: 'uploads/rozmaryn.jpeg',
  },
  {
    name: 'Rumianek',
    description: 'Naturalny rumianek, idealny do parzenia herbat i naparów.',
    price: 8.5,
    category: 'inne',
    stock_quantity: 80,
    image: 'uploads/rumianek.jpeg',
  },
  {
    name: 'Ser Feta',
    description:
      'Tradycyjny ser feta, doskonały do sałatek greckich i innych potraw.',
    price: 70.0,
    category: 'inne',
    stock_quantity: 40,
    image: 'uploads/feta.jpg',
  },
];

export default others;
