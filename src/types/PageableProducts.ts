import { Products } from '../entities/products.entity';

export interface PageableProducts {
  data: Products[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
}
