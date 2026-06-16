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
import AutoAwesomeTwoToneIcon from '@mui/icons-material/AutoAwesomeTwoTone';
import FolderTwoToneIcon from '@mui/icons-material/FolderTwoTone';
import HistoryTwoToneIcon from '@mui/icons-material/HistoryTwoTone';
import ViewKanbanTwoToneIcon from '@mui/icons-material/ViewKanbanTwoTone';
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded';
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
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Links from 'assets/links';
import { useEffect, useState } from 'react';
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

  const buyDisabled =
    purchaseInFlight || restoreInFlight || loadingProduct || !product;

  const proFeatures = [
    { Icon: ViewKanbanTwoToneIcon, label: t('core:buyProFeaturePerspectives') },
    { Icon: AutoAwesomeTwoToneIcon, label: t('core:buyProFeatureAI') },
    { Icon: HistoryTwoToneIcon, label: t('core:buyProFeatureRevisions') },
    { Icon: FolderTwoToneIcon, label: t('core:buyProFeatureFolderColor') },
  ];

  return (
    <Dialog
      open={open}
      onClose={purchaseInFlight ? undefined : onClose}
      fullScreen={smallScreen}
      fullWidth
      maxWidth="xs"
      keepMounted
      scroll="paper"
      aria-labelledby="buy-pro-dialog-title"
    >
      <TsDialogTitle
        dialogTitle={''}
        closeButtonTestId="closeBuyProDialogTID"
        onClose={purchaseInFlight ? undefined : onClose}
      />
      <DialogContent sx={{ paddingTop: 0 }}>
        <Stack spacing={2.5}>
          {/* Hero header with Pro branding */}
          <Box
            sx={{
              background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
              color: theme.palette.primary.contrastText,
              borderRadius: AppConfig.defaultCSSRadius,
              padding: 3,
              textAlign: 'center',
            }}
          >
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <WorkspacePremiumRoundedIcon sx={{ fontSize: 38 }} />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {t('core:tagSpacesPro')}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, marginTop: 0.5 }}>
              {t('core:buyProSubtitle')}
            </Typography>
          </Box>

          {/* Feature checklist */}
          <Stack spacing={1.5} sx={{ paddingX: 0.5 }}>
            {proFeatures.map((feature, index) => (
              <Box
                key={index}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <feature.Icon
                  sx={{ color: 'primary.main', fontSize: 26, flexShrink: 0 }}
                />
                <Typography variant="body2">{feature.label}</Typography>
              </Box>
            ))}
          </Stack>

          {/* Price emphasis */}
          <Box
            sx={{
              textAlign: 'center',
              padding: 2,
              borderRadius: AppConfig.defaultCSSRadius,
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
            }}
          >
            <Typography
              variant="h4"
              data-tid="buyProPriceTID"
              sx={{ fontWeight: 700 }}
            >
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
          gap: 1,
          flexDirection: 'column',
          alignItems: 'stretch',
        }}
      >
        <TsButton
          data-tid="buyProConfirmTID"
          variant="contained"
          onClick={onBuyClick}
          disabled={buyDisabled}
          sx={{
            minHeight: 52,
            fontWeight: 600,
            fontSize: '15px',
            ...(buyDisabled
              ? {}
              : {
                  background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
                }),
          }}
        >
          {purchaseInFlight ? (
            <CircularProgress size={20} color="inherit" />
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
