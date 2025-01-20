import { Product } from '../entities/product.entity';

export interface PageableProducts {
  data: Product[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
}
