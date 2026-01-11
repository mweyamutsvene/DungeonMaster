import { Item } from "./item.js";

export class Equipment extends Item {
  public readonly name: string;
  public readonly weightLb?: number;

  public constructor(params: { name: string; weightLb?: number }) {
    super();
    this.name = params.name;
    this.weightLb = params.weightLb;
  }
}
