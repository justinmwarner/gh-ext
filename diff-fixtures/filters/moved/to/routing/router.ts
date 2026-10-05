import { plural } from '../strings';

export interface Route {
  path: string;
  title: string;
}

export function describe(routes: readonly Route[]): string {
  return `${plural(routes.length, 'route')} registered`;
}

export function find(routes: readonly Route[], path: string): Route | undefined {
  return routes.find((route) => route.path === path);
}
