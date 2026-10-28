function named(target: any): void { console.log("anonymous", target.name); }
@named export default class { value = "default"; }
