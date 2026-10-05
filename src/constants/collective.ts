import type { ProductSeed } from '../seeds/product-seed';

const collective: ProductSeed[] = [
  {
    price: 12.0,
    category: 'worki',
    stock_quantity: 200,
    image: 'uploads/burakworek.jpeg',
    translations: {
      pl: {
        name: 'Burak worek',
        description:
          'Świeże buraki pakowane w worek, idealne do różnych potraw i przetworów.',
      },
      en: {
        name: 'Beetroot Sack',
        description:
          'Fresh beetroots packed in a sack, ideal for a variety of dishes and preserves.',
      },
    },
  },
  {
    price: 16.0,
    category: 'worki',
    stock_quantity: 150,
    image: 'uploads/cebulaworek.jpeg',
    translations: {
      pl: {
        name: 'Cebula worek',
        description:
          'Zdrowa cebula pakowana w worek, doskonała jako podstawowy składnik wielu dań.',
      },
      en: {
        name: 'Onion Sack',
        description:
          'Healthy onions packed in a sack, a staple ingredient in many dishes.',
      },
    },
  },
  {
    price: 5.0,
    category: 'worki',
    stock_quantity: 100,
    image: 'uploads/jarzynka.jpg',
    translations: {
      pl: {
        name: 'Jarzynka',
        description:
          'Świeże jarzynki pakowane w worek, gotowe do użycia w różnych potrawach.',
      },
      en: {
        name: 'Soup Vegetable Mix',
        description:
          'Fresh soup vegetables packed in a sack, ready to use in a variety of dishes.',
      },
    },
  },
  {
    price: 15.0,
    category: 'worki',
    stock_quantity: 180,
    image: 'uploads/marchewworek.png',
    translations: {
      pl: {
        name: 'Marchew worek',
        description:
          'Soczyste marchewki pakowane w worek, bogate w witaminy i minerały.',
      },
      en: {
        name: 'Carrot Sack',
        description:
          'Juicy carrots packed in a sack, rich in vitamins and minerals.',
      },
    },
  },
  {
    price: 25.0,
    category: 'worki',
    stock_quantity: 120,
    image: 'uploads/selerworek.jpg',
    translations: {
      pl: {
        name: 'Seler worek 5 kg',
        description:
          'Zdrowy seler pakowany w worek, doskonały do sałatek i zup.',
      },
      en: {
        name: 'Celeriac Sack 5 kg',
        description:
          'Healthy celeriac packed in a sack, excellent for salads and soups.',
      },
    },
  },
  {
    price: 33.0,
    category: 'worki',
    stock_quantity: 80,
    image: 'uploads/ziemniakworek15kg.jpeg',
    translations: {
      pl: {
        name: 'Ziemniak worek 15 kg',
        description:
          'Świeże ziemniaki pakowane w worek, idealne do różnych dań kulinarnych.',
      },
      en: {
        name: 'Potato Sack 15 kg',
        description:
          'Fresh potatoes packed in a sack, ideal for a variety of dishes.',
      },
    },
  },
  {
    price: 15.0,
    category: 'worki',
    stock_quantity: 150,
    image: 'uploads/ziemniakworek5kg.jpeg',
    translations: {
      pl: {
        name: 'Ziemniak żółty 5 kg',
        description:
          'Złociste ziemniaki pakowane w worek, doskonałe jako dodatek do obiadów.',
      },
      en: {
        name: 'Yellow Potatoes 5 kg',
        description:
          'Golden potatoes packed in a sack, excellent as a side for dinners.',
      },
    },
  },
];

export default collective;
