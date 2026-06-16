/**
 * TagSpaces - universal file and folder organizer
 * Copyright (C) 2017-present TagSpaces GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License (version 3) as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 */

// In-app purchase sheet for the Capacitor mobile apps. Shown when the
// user taps "Compare and Upgrade" inside the ProTeaserDialog on iOS or
// Android. Drives the StoreKit / Play Billing purchase via the iap
// service. Both stores forbid linking out from the purchase flow, so
// this sheet replaces the external URL CTA used on desktop.

import AppConfig from '-/AppConfig';
import TsButton from '-/components/TsButton';
import TsDialogTitle from '-/components/dialogs/components/TsDialogTitle';
import {
  getProProduct,
  IAPProduct,
  isIapAvailable,
  purchasePro,
  restoreProPurchase,
} from '-/services/iap';
import { openURLExternally } from '-/services/utils-io';
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Links from 'assets/links';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
}

function BuyProDialog(props: Props) {
  const { open, onClose } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const smallScreen = useMediaQuery(theme.breakpoints.down('md'));

  const [product, setProduct] = useState<IAPProduct | null>(null);
  const [loadingProduct, setLoadingProduct] = useState<boolean>(false);
  const [purchaseInFlight, setPurchaseInFlight] = useState<boolean>(false);
  const [restoreInFlight, setRestoreInFlight] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    kind: 'info' | 'error' | 'success';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!isIapAvailable()) return;
    let cancelled = false;
    setLoadingProduct(true);
    setStatusMessage(null);
    getProProduct()
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
      })
      .catch(() => {
        if (cancelled) return;
        setProduct(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingProduct(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function onBuyClick() {
    setPurchaseInFlight(true);
    setStatusMessage(null);
    try {
      const result = await purchasePro();
      if (result.success) {
        setStatusMessage({
          kind: 'success',
          text: t('core:purchaseCompleteReloading'),
        });
        // The verify→finish listener in iap.ts triggers a reload shortly.
        return;
      }
      if (result.cancelled) {
        setStatusMessage(null);
        return;
      }
      setStatusMessage({
        kind: 'error',
        text: result.error ?? t('core:purchaseFailed'),
      });
    } finally {
      setPurchaseInFlight(false);
    }
  }

  async function onRestoreClick() {
    setRestoreInFlight(true);
    setStatusMessage(null);
    try {
      const result = await restoreProPurchase();
      if (result.restored) {
        setStatusMessage({
          kind: 'success',
          text: t('core:restoreCompleteReloading'),
        });
        return;
      }
      setStatusMessage({
        kind: 'info',
        text: t('core:noPurchaseFoundToRestore'),
      });
    } finally {
      setRestoreInFlight(false);
    }
  }

  const priceLine =
    product?.price ||
    (loadingProduct ? t('core:loading') : t('core:priceUnavailable'));

  return (
    <Dialog
      open={open}
      onClose={purchaseInFlight ? undefined : onClose}
      fullScreen={smallScreen}
      keepMounted
      scroll="paper"
      aria-labelledby="buy-pro-dialog-title"
    >
      <TsDialogTitle
        dialogTitle={t('core:tagSpacesPro')}
        closeButtonTestId="closeBuyProDialogTID"
        onClose={purchaseInFlight ? undefined : onClose}
      />
      <DialogContent>
        <Stack spacing={2} sx={{ paddingTop: 1 }}>
          <Typography variant="body1">{t('core:buyProSubtitle')}</Typography>

          <Box
            sx={{
              borderRadius: AppConfig.defaultCSSRadius + 'px',
              border: '1px solid',
              borderColor: 'divider',
              padding: 2,
            }}
          >
            <Typography variant="body2">
              {t('core:buyProFeaturesList')}
            </Typography>
          </Box>

          <Box
            sx={{
              textAlign: 'center',
              paddingTop: 1,
            }}
          >
            <Typography variant="h4" data-tid="buyProPriceTID">
              {priceLine}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('core:oneTimePurchase')}
            </Typography>
          </Box>

          {statusMessage && (
            <Alert severity={statusMessage.kind}>{statusMessage.text}</Alert>
          )}

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center' }}
          >
            {t('core:familySharingNote')}{' '}
            <Link
              component="button"
              type="button"
              onClick={() => openURLExternally(Links.links.privacyURL, true)}
              underline="hover"
            >
              {t('core:privacyPolicy')}
            </Link>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          // env(safe-area-inset-*) keeps buttons clear of the iPhone home
          // indicator and Android gesture-nav strip on fullScreen mobile.
          paddingLeft: 'max(16px, env(safe-area-inset-left))',
          paddingRight: 'max(16px, env(safe-area-inset-right))',
          paddingTop: 1,
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          borderTop: '1px solid',
          borderColor: 'divider',
          gap: 1,
          flexDirection: 'column',
          alignItems: 'stretch',
        }}
      >
        <TsButton
          data-tid="buyProConfirmTID"
          variant="contained"
          onClick={onBuyClick}
          disabled={
            purchaseInFlight || restoreInFlight || loadingProduct || !product
          }
          sx={{ minHeight: 48 }}
        >
          {purchaseInFlight ? (
            <CircularProgress size={20} />
          ) : (
            t('core:buyProAction', { price: product?.price ?? '' })
          )}
        </TsButton>
        <TsButton
          data-tid="buyProRestoreTID"
          variant="text"
          onClick={onRestoreClick}
          disabled={purchaseInFlight || restoreInFlight}
        >
          {restoreInFlight ? (
            <CircularProgress size={18} />
          ) : (
            t('core:restorePurchases')
          )}
        </TsButton>
      </DialogActions>
    </Dialog>
  );
}

export default BuyProDialog;
