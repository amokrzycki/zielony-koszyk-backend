import { ProductResponseDto } from '../dto/product-response.dto';

export interface PageableProducts {
  data: ProductResponseDto[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
}
