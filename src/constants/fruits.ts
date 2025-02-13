const fruits = [
  {
    name: 'Ananas',
    description: 'Egzotyczny ananas pełen słodyczy',
    price: 10.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/ananas.png',
  },
  {
    name: 'Banan',
    description: 'Pyszny i zdrowy banan',
    price: 6.5,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/banan.png',
  },
  {
    name: 'Borówka Amerykańska',
    description: 'Świeże borówki amerykańskie pełne witamin',
    price: 15.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/borowka.png',
  },
  {
    name: 'Cytryna',
    description: 'Soczysta cytryna do każdej herbaty',
    price: 8.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/cytryna.png',
  },
  {
    name: 'Czereśnie',
    description: 'Słodkie czereśnie idealne na deser',
    price: 12.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/czeresnie.jpeg',
  },
  {
    name: 'Grapefruit',
    description: 'Świeży grapefruit o orzeźwiającym smaku',
    price: 8.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/grapefruit.jpeg',
  },
  {
    name: 'Gruszka',
    description: 'Soczysta gruszka prosto z sadu',
    price: 7.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/gruszka.jpeg',
  },
  {
    name: 'Jabłka Golden Delicjusz',
    description: 'Złote jabłka o delikatnym smaku',
    price: 3.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka.jpeg',
  },
  {
    name: 'Jabłka Koksa Górska',
    description: 'Aromatyczne jabłka z gór',
    price: 3.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka2.jpeg',
  },
  {
    name: 'Jabłka Szara Reneta',
    description: 'Tradycyjne jabłka pełne smaku',
    price: 3.5,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka3.jpeg',
  },
  {
    name: 'Jabłka Champion',
    description: 'Świeże jabłka champion o intensywnym smaku',
    price: 3.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka.jpeg',
  },
  {
    name: 'Jabłka Ligol',
    description: 'Jabłka Ligol o chrupiącej konsystencji',
    price: 3.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka3.jpeg',
  },
  {
    name: 'Jabłka Prins',
    description: 'Jabłka Prins pełne naturalnej słodyczy',
    price: 3.5,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka2.jpeg',
  },
  {
    name: 'Jabłka Rubin',
    description: 'Rubinowe jabłka o intensywnym kolorze',
    price: 3.5,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/jablka.jpeg',
  },
  {
    name: 'Kiwi Koszyk',
    description: 'Świeże kiwi w praktycznym koszyku',
    price: 12.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/kiwikoszyk.jpeg',
  },
  {
    name: 'Kiwi Luz',
    description: 'Pojedyncze kiwi pełne witaminy C',
    price: 15.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/kiwiluz.jpeg',
  },
  {
    name: 'Limonka',
    description: 'Orzeźwiająca limonka do napojów i potraw',
    price: 18.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/limonka.jpg',
  },
  {
    name: 'Malina',
    description: 'Delikatne maliny o intensywnym smaku',
    price: 15.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/malina.jpeg',
  },
  {
    name: 'Mandarynka',
    description: 'Słodka mandarynka idealna na przekąskę',
    price: 8.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/mandarynka.jpeg',
  },
  {
    name: 'Mango',
    description: 'Egzotyczne mango pełne aromatu',
    price: 7.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/mango.jpeg',
  },
  {
    name: 'Melon Żółty',
    description: 'Soczysty żółty melon na letnie dni',
    price: 14.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/melon.jpeg',
  },
  {
    name: 'Morela Polska',
    description: 'Świeże polskie morele o słodkim smaku',
    price: 15.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/morela.jpeg',
  },
  {
    name: 'Pomarańcze',
    description: 'Soczyste pomarańcze pełne witaminy C',
    price: 8.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/pomarancze.png',
  },
  {
    name: 'Śliwka',
    description: 'Świeże śliwki o intensywnym smaku',
    price: 5.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/sliwka.jpeg',
  },
  {
    name: 'Śliwka Węgierka',
    description: 'Aromatyczne śliwki węgierki',
    price: 5.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/sliwka2.jpeg',
  },
  {
    name: 'Truskawka Grecja',
    description: 'Soczyste truskawki z Grecji',
    price: 20.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/truskawka.jpeg',
  },
  {
    name: 'Winogrono Białe',
    description: 'Świeże białe winogrona o słodkim smaku',
    price: 19.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/winogrono.jpeg',
  },
  {
    name: 'Winogrono Czerwone',
    description: 'Świeże czerwone winogrona pełne aromatu',
    price: 19.0,
    category: 'owoce',
    stock_quantity: 50,
    image: 'uploads/winogrono.png',
  },
];

export default fruits;
