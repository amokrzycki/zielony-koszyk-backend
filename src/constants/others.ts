import type { ProductSeed } from '../seeds/product-seed';

const others: ProductSeed[] = [
  {
    price: 49.0,
    category: 'inne',
    stock_quantity: 50,
    image: 'uploads/oliwazoliwek.png',
    translations: {
      pl: {
        name: 'BRINIZA Oliwa z Oliwek 500 ml',
        description:
          'Wysokiej jakości oliwa z liwek, idealna do sałatek i gotowania.',
      },
      en: {
        name: 'BRINIZA Olive Oil 500 ml',
        description: 'High-quality olive oil, ideal for salads and cooking.',
      },
    },
  },
  {
    price: 220.0,
    category: 'inne',
    stock_quantity: 30,
    image: 'uploads/oliwazliwek.png',
    translations: {
      pl: {
        name: 'BRINIZA Oliwa z Oliwek 3 lt',
        description:
          'Duża butelka oliwy z oliwek, doskonała do codziennego użytku w kuchni.',
      },
      en: {
        name: 'BRINIZA Olive Oil 3 L',
        description:
          'Large bottle of olive oil, perfect for everyday use in the kitchen.',
      },
    },
  },
  {
    price: 320.0,
    category: 'inne',
    stock_quantity: 20,
    image: 'uploads/oliwazliwek.png',
    translations: {
      pl: {
        name: 'BRINIZA Oliwa z Oliwek 5 lt',
        description:
          'Ekstra duża butelka oliwy z oliwek, idealna dla dużych rodzin i restauracji.',
      },
      en: {
        name: 'BRINIZA Olive Oil 5 L',
        description:
          'Extra-large bottle of olive oil, ideal for big families and restaurants.',
      },
    },
  },
  {
    price: 69.0,
    category: 'inne',
    stock_quantity: 40,
    image: 'uploads/oliwa750.png',
    translations: {
      pl: {
        name: 'BRINIZA Oliwa z Oliwek 750 ml',
        description:
          'Butelka oliwy z oliwek o pojemności 750 ml, doskonała do smażenia i sałatek.',
      },
      en: {
        name: 'BRINIZA Olive Oil 750 ml',
        description:
          'A 750 ml bottle of olive oil, great for frying and salads.',
      },
    },
  },
  {
    price: 10.0,
    category: 'inne',
    stock_quantity: 80,
    image: 'uploads/herbata.jpeg',
    translations: {
      pl: {
        name: 'Herbata górska Gojnik',
        description:
          'Aromatyczna herbata górska z liści gojnika, doskonała na chłodne wieczory.',
      },
      en: {
        name: 'Gojnik Mountain Tea',
        description:
          'Aromatic mountain tea made from gojnik leaves, perfect for chilly evenings.',
      },
    },
  },
  {
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
    image: 'uploads/lisclaurowy.jpeg',
    translations: {
      pl: {
        name: 'Liść Laurowy',
        description: 'Suszone liście laurowe, niezbędne w każdej kuchni.',
      },
      en: {
        name: 'Bay Leaf',
        description: 'Dried bay leaves, essential in every kitchen.',
      },
    },
  },
  {
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
    image: 'uploads/miod.png',
    translations: {
      pl: {
        name: 'Miód Dębowy',
        description: 'Naturalny miód dębowy o intensywnym smaku i aromacie.',
      },
      en: {
        name: 'Oak Honey',
        description: 'Natural oak honey with an intense flavor and aroma.',
      },
    },
  },
  {
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
    image: 'uploads/miod.png',
    translations: {
      pl: {
        name: 'Miód Kwiatowy',
        description: 'Delikatny miód kwiatowy, idealny do herbaty i wypieków.',
      },
      en: {
        name: 'Wildflower Honey',
        description: 'Delicate wildflower honey, ideal for tea and baking.',
      },
    },
  },
  {
    price: 85.0,
    category: 'inne',
    stock_quantity: 25,
    image: 'uploads/miod.png',
    translations: {
      pl: {
        name: 'Miód Sosnowy',
        description: 'Unikalny miód sosnowy o świeżym, leśnym aromacie.',
      },
      en: {
        name: 'Pine Honey',
        description: 'Unique pine honey with a fresh, forest aroma.',
      },
    },
  },
  {
    price: 15.0,
    category: 'inne',
    stock_quantity: 50,
    image: 'uploads/ocet.jpeg',
    translations: {
      pl: {
        name: 'Ocet Balsamiczny',
        description:
          'Wysokiej jakości ocet balsamiczny, doskonały do sałatek i marynat.',
      },
      en: {
        name: 'Balsamic Vinegar',
        description:
          'High-quality balsamic vinegar, excellent for salads and marinades.',
      },
    },
  },
  {
    price: 16.0,
    category: 'inne',
    stock_quantity: 45,
    image: 'uploads/ocet1.jpeg',
    translations: {
      pl: {
        name: 'Ocet balsamiczny z miodem',
        description:
          'Ocet balsamiczny wzbogacony o naturalny miód, idealny do sosów i marynat.',
      },
      en: {
        name: 'Balsamic Vinegar with Honey',
        description:
          'Balsamic vinegar enriched with natural honey, ideal for sauces and marinades.',
      },
    },
  },
  {
    price: 8.5,
    category: 'inne',
    stock_quantity: 60,
    image: 'uploads/ocet2.jpeg',
    translations: {
      pl: {
        name: 'Ocet biały winogronowy',
        description:
          'Lekki ocet winogronowy, idealny do delikatnych potraw i sałatek.',
      },
      en: {
        name: 'White Grape Vinegar',
        description:
          'Light grape vinegar, ideal for delicate dishes and salads.',
      },
    },
  },
  {
    price: 8.0,
    category: 'inne',
    stock_quantity: 60,
    image: 'uploads/ocet3.jpeg',
    translations: {
      pl: {
        name: 'Ocet czerwony winogronowy',
        description:
          'Ocet winogronowy o głębokim, bogatym smaku, doskonały do mięs i warzyw.',
      },
      en: {
        name: 'Red Grape Vinegar',
        description:
          'Grape vinegar with a deep, rich flavor, excellent with meats and vegetables.',
      },
    },
  },
  {
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
    image: 'uploads/ocet.jpeg',
    translations: {
      pl: {
        name: 'Ocet winny z bazylią',
        description:
          'Aromatyczny ocet winny z dodatkiem świeżej bazylii, idealny do sałatek.',
      },
      en: {
        name: 'Basil Wine Vinegar',
        description:
          'Aromatic wine vinegar with fresh basil, ideal for salads.',
      },
    },
  },
  {
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
    image: 'uploads/ocet1.jpeg',
    translations: {
      pl: {
        name: 'Ocet winny z czosnkiem',
        description:
          'Intensywny ocet winny z dodatkiem czosnku, doskonały do marynat.',
      },
      en: {
        name: 'Garlic Wine Vinegar',
        description:
          'Intense wine vinegar with garlic, excellent for marinades.',
      },
    },
  },
  {
    price: 10.0,
    category: 'inne',
    stock_quantity: 55,
    image: 'uploads/ocet2.jpeg',
    translations: {
      pl: {
        name: 'Ocet winny z estragonem',
        description:
          'Ocet winny wzbogacony o aromatyczny estragon, idealny do potraw mięsnych.',
      },
      en: {
        name: 'Tarragon Wine Vinegar',
        description:
          'Wine vinegar infused with aromatic tarragon, ideal for meat dishes.',
      },
    },
  },
  {
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwki.jpg',
    translations: {
      pl: {
        name: 'Oliwki Kalamon',
        description:
          'Klasyczne oliwki Kalamon w mniejszym opakowaniu, idealne do przekąsek.',
      },
      en: {
        name: 'Kalamata Olives',
        description:
          'Classic Kalamata olives in a smaller pack, ideal for snacking.',
      },
    },
  },
  {
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwkimarynowane.png',
    translations: {
      pl: {
        name: 'Oliwki marynowane',
        description: 'Aromatyczne oliwki marynowane w ziołach i przyprawach.',
      },
      en: {
        name: 'Marinated Olives',
        description: 'Aromatic olives marinated in herbs and spices.',
      },
    },
  },
  {
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwki1.jpg',
    translations: {
      pl: {
        name: 'Oliwki mix',
        description:
          'Mieszanka różnych oliwek, idealna do sałatek i przekąsek.',
      },
      en: {
        name: 'Mixed Olives',
        description: 'A mix of different olives, ideal for salads and snacks.',
      },
    },
  },
  {
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
    image: 'uploads/oliwki2.jpeg',
    translations: {
      pl: {
        name: 'Oliwki z czosnkiem',
        description:
          'Oliwki wzbogacone o aromatyczny czosnek, doskonałe do przekąsek.',
      },
      en: {
        name: 'Garlic Olives',
        description:
          'Olives infused with aromatic garlic, excellent for snacking.',
      },
    },
  },
  {
    price: 19.0,
    category: 'inne',
    stock_quantity: 75,
    image: 'uploads/oliwki.png',
    translations: {
      pl: {
        name: 'Oliwki zielone',
        description:
          'Klasyczne zielone oliwki, doskonałe do sałatek i przekąsek.',
      },
      en: {
        name: 'Green Olives',
        description: 'Classic green olives, excellent for salads and snacks.',
      },
    },
  },
  {
    price: 65.0,
    category: 'inne',
    stock_quantity: 35,
    image: 'uploads/oliwki.jpg',
    translations: {
      pl: {
        name: 'Oliwki zielone drylowane',
        description:
          'Drylowane zielone oliwki, idealne do gotowania i sałatek.',
      },
      en: {
        name: 'Pitted Green Olives',
        description: 'Pitted green olives, ideal for cooking and salads.',
      },
    },
  },
  {
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
    image: 'uploads/oregano.jpg',
    translations: {
      pl: {
        name: 'Oregano Górskie',
        description:
          'Aromatyczne górskie oregano, idealne do przyprawiania potraw.',
      },
      en: {
        name: 'Mountain Oregano',
        description: 'Aromatic mountain oregano, ideal for seasoning dishes.',
      },
    },
  },
  {
    price: 5.0,
    category: 'inne',
    stock_quantity: 100,
    image: 'uploads/rozmaryn.jpeg',
    translations: {
      pl: {
        name: 'Rozmaryn',
        description: 'Świeży rozmaryn, doskonały do mięs i pieczeni.',
      },
      en: {
        name: 'Rosemary',
        description: 'Fresh rosemary, excellent for meats and roasts.',
      },
    },
  },
  {
    price: 8.5,
    category: 'inne',
    stock_quantity: 80,
    image: 'uploads/rumianek.jpeg',
    translations: {
      pl: {
        name: 'Rumianek',
        description:
          'Naturalny rumianek, idealny do parzenia herbat i naparów.',
      },
      en: {
        name: 'Chamomile',
        description: 'Natural chamomile, ideal for brewing teas and infusions.',
      },
    },
  },
  {
    price: 70.0,
    category: 'inne',
    stock_quantity: 40,
    image: 'uploads/feta.jpg',
    translations: {
      pl: {
        name: 'Ser Feta',
        description:
          'Tradycyjny ser feta, doskonały do sałatek greckich i innych potraw.',
      },
      en: {
        name: 'Feta Cheese',
        description:
          'Traditional feta cheese, excellent for Greek salads and other dishes.',
      },
    },
  },
];

export default others;
