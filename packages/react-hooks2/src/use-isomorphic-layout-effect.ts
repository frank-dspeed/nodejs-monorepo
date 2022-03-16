import * as React from 'react';
import { isSSR } from '@straw-hat/is-ssr';

export const useIsomorphicLayoutEffect = isSSR() ? React.useEffect : React.useLayoutEffect;
