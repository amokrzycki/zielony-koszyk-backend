/* eslint-disable */
export default async () => {
    const t = {
        ["./enums/AddressType"]: await import("./enums/AddressType"),
        ["./types/CustomerType"]: await import("./types/CustomerType"),
        ["./entities/user.entity"]: await import("./entities/user.entity"),
        ["./enums/Roles"]: await import("./enums/Roles"),
        ["./entities/address.entity"]: await import("./entities/address.entity"),
        ["./types/OrderType"]: await import("./types/OrderType"),
        ["./enums/Statuses"]: await import("./enums/Statuses"),
        ["./entities/order-item.entity"]: await import("./entities/order-item.entity"),
        ["./entities/order.entity"]: await import("./entities/order.entity"),
        ["./entities/product.entity"]: await import("./entities/product.entity"),
        ["./dto/create-address.dto"]: await import("./dto/create-address.dto"),
        ["./dto/create-order-item.dto"]: await import("./dto/create-order-item.dto")
    };
    return { "@nestjs/swagger": { "models": [[import("./entities/address.entity"), { "Address": { address_id: { required: true, type: () => Number }, first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, company_name: { required: true, type: () => String }, nip: { required: true, type: () => String }, phone: { required: true, type: () => String }, street: { required: true, type: () => String }, building_number: { required: true, type: () => String }, flat_number: { required: true, type: () => String }, city: { required: true, type: () => String }, zip: { required: true, type: () => String }, type: { required: true, enum: t["./enums/AddressType"].AddressType }, customer_type: { required: true, enum: t["./types/CustomerType"].CustomerType }, is_user_address: { required: true, type: () => Boolean }, default: { required: true, type: () => Boolean }, user_id: { required: false, type: () => String }, user: { required: true, type: () => t["./entities/user.entity"].User } } }], [import("./entities/user.entity"), { "User": { user_id: { required: true, type: () => String }, role: { required: true, enum: t["./enums/Roles"].Roles }, password: { required: true, type: () => String }, email: { required: true, type: () => String }, first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, addresses: { required: true, type: () => [t["./entities/address.entity"].Address] }, phone: { required: true, type: () => String }, created_at: { required: true, type: () => Date }, updated_at: { required: true, type: () => Date } } }], [import("./entities/order.entity"), { "Order": { order_id: { required: true, type: () => Number }, user_id: { required: true, type: () => String }, order_type: { required: true, enum: t["./types/OrderType"].OrderType }, user: { required: true, type: () => t["./entities/user.entity"].User }, customer_email: { required: true, type: () => String }, billingAddress: { required: true, type: () => t["./entities/address.entity"].Address }, shippingAddress: { required: true, type: () => t["./entities/address.entity"].Address }, order_date: { required: true, type: () => Date }, total_amount: { required: true, type: () => Number }, status: { required: true, enum: t["./enums/Statuses"].Statuses }, orderItems: { required: true, type: () => [t["./entities/order-item.entity"].OrderItem] }, invoice_path: { required: true, type: () => String } } }], [import("./entities/product.entity"), { "Product": { product_id: { required: true, type: () => Number }, name: { required: true, type: () => String }, description: { required: true, type: () => String }, price: { required: true, type: () => Number }, category: { required: true, type: () => String }, stock_quantity: { required: true, type: () => Number }, image: { required: true, type: () => String }, created_at: { required: true, type: () => Date }, updated_at: { required: true, type: () => Date } } }], [import("./entities/order-item.entity"), { "OrderItem": { order_item_id: { required: true, type: () => Number }, order_id: { required: true, type: () => Number }, order: { required: true, type: () => t["./entities/order.entity"].Order }, product_id: { required: true, type: () => Number }, product: { required: true, type: () => t["./entities/product.entity"].Product }, product_name: { required: true, type: () => String }, quantity: { required: true, type: () => Number }, price: { required: true, type: () => Number } } }], [import("./dto/create-order-item.dto"), { "CreateOrderItemDto": { product_id: { required: true, type: () => Number }, quantity: { required: true, type: () => Number }, price: { required: true, type: () => Number } } }], [import("./dto/create-address.dto"), { "CreateAddressDto": { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, company_name: { required: true, type: () => String }, nip: { required: true, type: () => String, minLength: 10, maxLength: 11 }, phone: { required: true, type: () => String }, street: { required: true, type: () => String }, city: { required: true, type: () => String }, zip: { required: true, type: () => String }, building_number: { required: true, type: () => String }, flat_number: { required: true, type: () => String }, type: { required: true, enum: t["./enums/AddressType"].AddressType }, default: { required: true, type: () => Boolean }, customer_type: { required: true, enum: t["./types/CustomerType"].CustomerType } } }], [import("./dto/create-order.dto"), { "CreateOrderDto": { user_id: { required: false, type: () => String }, order_type: { required: true, enum: t["./types/OrderType"].OrderType }, billingAddress: { required: false, type: () => t["./dto/create-address.dto"].CreateAddressDto }, shippingAddress: { required: false, type: () => t["./dto/create-address.dto"].CreateAddressDto }, same_address: { required: true, type: () => Boolean }, customer_email: { required: true, type: () => String }, orderItems: { required: true, type: () => [t["./dto/create-order-item.dto"].CreateOrderItemDto] } } }], [import("./dto/update-order.dto"), { "UpdateOrderDto": { order_type: { required: true, enum: t["./types/OrderType"].OrderType }, customer_email: { required: true, type: () => String, format: "email" }, billingAddress: { required: true, type: () => t["./entities/address.entity"].Address }, shippingAddress: { required: true, type: () => t["./entities/address.entity"].Address }, status: { required: true, enum: t["./enums/Statuses"].Statuses } } }], [import("./dto/register-user.dto"), { "RegisterUserDto": { email: { required: true, type: () => String, format: "email" }, first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, street: { required: true, type: () => String }, building_number: { required: true, type: () => String }, flat_number: { required: true, type: () => String }, zip: { required: true, type: () => String }, city: { required: true, type: () => String }, phone: { required: true, type: () => String }, password: { required: true, type: () => String, minLength: 8 } } }], [import("./dto/update-user.dto"), { "UpdateUserDto": { email: { required: true, type: () => String, format: "email" }, first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, phone: { required: true, type: () => String } } }], [import("./dto/create-user.dto"), { "CreateUserDto": { email: { required: true, type: () => String, format: "email" }, first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, street: { required: true, type: () => String }, building_number: { required: true, type: () => String }, flat_number: { required: true, type: () => String }, zip: { required: true, type: () => String }, city: { required: true, type: () => String }, phone: { required: true, type: () => String }, role: { required: true, enum: t["./enums/Roles"].Roles } } }], [import("./dto/create-product.dto"), { "CreateProductDto": { name: { required: true, type: () => String }, description: { required: true, type: () => String }, price: { required: true, type: () => Number }, category: { required: true, type: () => String }, stock_quantity: { required: true, type: () => Number } } }], [import("./dto/login.dto"), { "LoginDto": { email: { required: true, type: () => String }, password: { required: true, type: () => String } } }], [import("./dto/add-order-items.dto"), { "AddOrderItemsDto": { order_id: { required: true, type: () => Number }, product_id: { required: true, type: () => Number }, product_name: { required: true, type: () => String }, quantity: { required: true, type: () => Number }, price: { required: true, type: () => Number } } }]], "controllers": [[import("./app.controller"), { "AppController": { "healthCheck": { type: String } } }], [import("./controllers/order-item.controller"), { "OrderItemController": { "findAll": { type: [t["./entities/order-item.entity"].OrderItem] }, "findOne": { type: [t["./entities/order-item.entity"].OrderItem] }, "create": { type: [t["./entities/order-item.entity"].OrderItem] }, "update": { type: t["./entities/order-item.entity"].OrderItem }, "remove": {} } }], [import("./controllers/order.controller"), { "OrderController": { "findAll": { type: [t["./entities/order.entity"].Order] }, "findOrderByOrderId": { type: t["./entities/order.entity"].Order }, "downloadInvoice": {}, "findOrdersByUserId": { type: [t["./entities/order.entity"].Order] }, "create": { type: t["./entities/order.entity"].Order }, "update": { type: t["./entities/order.entity"].Order }, "remove": {} } }], [import("./controllers/user.controller"), { "UserController": { "findAll": { type: [t["./entities/user.entity"].User] }, "findOne": { type: t["./entities/user.entity"].User }, "register": { type: t["./entities/user.entity"].User }, "createUser": { type: t["./entities/user.entity"].User }, "update": { type: t["./entities/user.entity"].User }, "updatePassword": { type: t["./entities/user.entity"].User }, "remove": {}, "addAddress": { type: t["./entities/user.entity"].User }, "updateUserDetails": { type: t["./entities/user.entity"].User }, "getUserAddresses": { type: [t["./entities/address.entity"].Address] } } }], [import("./controllers/product.controller"), { "ProductController": { "getAll": { type: [t["./entities/product.entity"].Product] }, "searchProducts": { type: Object }, "getOne": { type: t["./entities/product.entity"].Product }, "create": { type: t["./entities/product.entity"].Product }, "update": { type: t["./entities/product.entity"].Product }, "remove": {}, "uploadImage": { type: t["./entities/product.entity"].Product } } }], [import("./auth/auth.controller"), { "AuthController": { "login": {} } }]] } };
};