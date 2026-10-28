var Box_1;
const order = [];
let Box = Box_1 = class Box {
    static created = order.push('static') && 'box';
    static of() { return Box_1; }
};
order.push(String(Box_1 === Box));
var Late;
Late = Box_1 = class Late { static id = 'late'; };
console.log(order.join(','), Box.of() === Box_1, Box.created, Late.id, Box_1.id);
