import React, {useEffect, useRef, useState} from 'react';
import type {AuthStore} from './AuthStore';
import {DriverButton, DriverCard, DriverCopy, DriverField, DriverTitle} from '../../components/DriverUI';
import {SettingsPasswordField} from '../../components/SettingsPresentation';
import {Alert} from '../../components/ThemedAlert';

export function DeleteAccountPanel({auth}: {auth: AuthStore}) {
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const valid=!!password && password.length<=128 && confirmation==='DELETE MY ACCOUNT';
  async function remove() {
    if(pending.current || !valid || !live.current)return;
    pending.current=true;setBusy(true);setError('');
    try {await auth.deleteAccount(password,confirmation);}
    catch {
      if(live.current)setError('Deletion could not be confirmed. Check your password and connection. Administrator accounts require an ownership review. If the connection was lost, sign in again to check account access.');
    } finally {
      pending.current=false;
      if(live.current){setBusy(false);setPassword('');}
    }
  }
  return <DriverCard>
    <DriverTitle small>Delete account</DriverTitle>
    <DriverCopy>Your personal profile is anonymized and account access is revoked. Personal saved preferences, favorites and eligible personal document records are removed.</DriverCopy>
    <DriverCopy>Financial, fleet, safety, audit, dispute and required business records are retained for policy review. Immutable backups are not modified. This does not cancel an external subscription or delete fleet-owned records.</DriverCopy>
    <DriverCopy>Retention periods require an approved policy. Compliance documents, documents linked to trucks and stored-file references are held for review. Cloud erasure and provider-side access revocation are not implied.</DriverCopy>
    <SettingsPasswordField label="Current password for deletion" value={password} onChange={setPassword} disabled={busy}/>
    <DriverField label="Type DELETE MY ACCOUNT" value={confirmation} onChangeText={setConfirmation} editable={!busy} autoCorrect={false} autoCapitalize="characters" maxLength={32}/>
    {!!error && <DriverCopy>{error}</DriverCopy>}
    <DriverButton title="Delete my account" disabled={!valid || busy} loading={busy} onPress={()=>{
      Alert.alert('Delete your account?', 'Your account access will be revoked. Retained business and safety records are not deleted.',[
        {text:'Cancel',style:'cancel'},
        {text:'Delete account',style:'destructive',onPress:()=>{void remove();}},
      ]);
    }}/>
  </DriverCard>;
}
