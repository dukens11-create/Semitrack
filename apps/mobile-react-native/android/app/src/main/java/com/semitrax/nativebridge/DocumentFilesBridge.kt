package com.semitrax.nativebridge

import android.app.Activity
import android.content.Intent
import android.content.ClipData
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

/** System camera / scoped document picker; no broad media/storage permission. */
class DocumentFilesBridge(private val context:ReactApplicationContext):BaseActivityEventListener() {
 private val main=Handler(Looper.getMainLooper())
 private val worker=Executors.newSingleThreadExecutor()
 private var pending:Promise?=null
 private var pendingArgs:JSONObject?=null
 private var capture:File?=null
 init {context.addActivityEventListener(this)}
 private fun bounded(stream:java.io.InputStream,limit:Int):ByteArray {val out=java.io.ByteArrayOutputStream();val chunk=ByteArray(8192);while(true){val count=stream.read(chunk);if(count<0)break;require(out.size()+count<=limit){"DOCUMENT_FILE_TOO_LARGE"};out.write(chunk,0,count)};return out.toByteArray()}
 private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
 private fun root(owner:String):File {require(owner.isNotBlank()&&owner.length<200);return File(context.filesDir,"documents/"+hash(owner.toByteArray())).apply{mkdirs()}}
 private fun file(args:JSONObject,id:String):File {require(Regex("[a-f0-9-]{36}").matches(id));val dir=root(args.getString("owner"));val f=File(dir,id);require(f.canonicalPath.startsWith(dir.canonicalPath+File.separator));return f}
 private fun fail(p:Promise,code:String){p.reject(code,when(code){"DOCUMENT_PICKER_DENIED"->"Allow camera access in the camera app or choose an existing photo.";"DOCUMENT_TYPE_UNSUPPORTED"->"Choose a JPG, PNG or PDF. HEIC must be exported as JPEG first.";else->"Document action could not finish. Keep the pending file and retry."})}
 fun command(command:String,payload:String,promise:Promise){try{
 val args=JSONObject(payload)
 when(command){
 "pick"->main.post{pick(args,promise)}
 "remove"->worker.execute{try{for(i in 0 until args.getJSONArray("ids").length())file(args,args.getJSONArray("ids").getString(i)).delete();promise.resolve("{}")}catch(_:Exception){fail(promise,"DOCUMENT_LOCAL_STORAGE_FAILED")}}
 "discardOwner"->worker.execute{try{val dir=root(args.getString("owner"));dir.listFiles()?.forEach{if(it.isFile)it.delete()};promise.resolve("{}")}catch(_:Exception){fail(promise,"DOCUMENT_LOCAL_STORAGE_FAILED")}}
 "open","share"->main.post{try{val activity=context.currentActivity?:throw IllegalStateException();val ids=args.getJSONArray("ids");require(ids.length()>0&&ids.length()<=args.getInt("maxCount"));val uris=ArrayList<Uri>();for(i in 0 until ids.length()){val f=file(args,ids.getString(i));require(f.exists());uris.add(FileProvider.getUriForFile(context,context.packageName+".documents",f,args.optJSONArray("names")?.optString(i)?.replace(Regex("""[\\/\x00-\x1f]"""),"_")?.take(150)?:f.name))};val intent=if(command=="open")Intent(Intent.ACTION_VIEW).setDataAndType(uris[0],args.getString("mimeType")) else Intent(Intent.ACTION_SEND_MULTIPLE).setType(args.optString("mimeType","*/*")).putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.clipData=ClipData.newUri(context.contentResolver,"Document",uris[0]);for(uri in uris.drop(1))intent.clipData!!.addItem(ClipData.Item(uri));activity.startActivity(Intent.createChooser(intent,if(command=="open")"Open document" else "Share document"));promise.resolve("{\"opened\":true}")}catch(_:Exception){fail(promise,"DOCUMENT_SHARE_UNAVAILABLE")}}
 "download"->worker.execute{download(args,promise)}
 else->fail(promise,"DOCUMENT_ACTION_UNSUPPORTED")
 }
 }catch(_:Exception){fail(promise,"DOCUMENT_ACTION_INVALID")}}
 private fun pick(args:JSONObject,promise:Promise){
 if(pending!=null){fail(promise,"DOCUMENT_PICKER_BUSY");return}
 try{val activity=context.currentActivity?:throw IllegalStateException();require(args.getInt("maxCount")>0);require(args.getInt("maxBytes")>0);val mode=args.getString("mode");val intent:Intent
 if(mode=="camera"){capture=file(args,UUID.randomUUID().toString());val uri=FileProvider.getUriForFile(context,context.packageName+".documents",capture!!);intent=Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.clipData=ClipData.newRawUri("Document photo",uri)}else{intent=Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(if(mode=="photos")"image/*" else "*/*").putExtra(Intent.EXTRA_MIME_TYPES,if(mode=="photos")arrayOf("image/jpeg","image/png")else arrayOf("application/pdf","image/jpeg","image/png")).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true)}
 pending=promise;pendingArgs=args;activity.startActivityForResult(intent,2409)
 }catch(_:SecurityException){pending=null;capture?.delete();capture=null;fail(promise,"DOCUMENT_PICKER_DENIED")}catch(_:Exception){pending=null;capture?.delete();capture=null;fail(promise,"DOCUMENT_PICKER_UNAVAILABLE")}
 }
 override fun onActivityResult(activity:Activity,requestCode:Int,resultCode:Int,data:Intent?){if(requestCode!=2409)return;val promise=pending?:return;val args=pendingArgs?:return;val camera=capture;pending=null;pendingArgs=null;capture=null
 if(resultCode!=Activity.RESULT_OK){camera?.delete();promise.resolve("[]");return}
 worker.execute{val created=mutableListOf<File>();try{
 val uris=mutableListOf<Uri>();if(camera!=null)uris.add(Uri.fromFile(camera))else if(data?.clipData!=null){for(i in 0 until data.clipData!!.itemCount)uris.add(data.clipData!!.getItemAt(i).uri)}else data?.data?.let{uris.add(it)}
 require(uris.size<=args.getInt("maxCount")){"DOCUMENT_PAGE_LIMIT"};val output=JSONArray();for(uri in uris){var name=if(camera!=null)"Document photo.jpg" else "";if(camera==null)context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())name=it.getString(0)}
 val input=context.contentResolver.openInputStream(uri)?:throw IllegalStateException();val raw=input.use{stream->val bytes=bounded(stream,args.getInt("maxBytes"));require(bytes.size<=args.getInt("maxBytes"));bytes};val target=file(args,UUID.randomUUID().toString());created.add(target);output.put(importBytes(args,target,raw,name))};promise.resolve(output.toString())
 }catch(_:UnsupportedOperationException){created.forEach{it.delete()};fail(promise,"DOCUMENT_TYPE_UNSUPPORTED")}catch(error:Exception){created.forEach{it.delete()};fail(promise,if(error.message=="DOCUMENT_FILE_TOO_LARGE"||error.message=="DOCUMENT_PAGE_LIMIT")error.message!! else "DOCUMENT_FILE_INVALID")}finally{camera?.delete()}}
 }
 private fun importBytes(args:JSONObject,target:File,raw:ByteArray,original:String):JSONObject {
 var mime:String;var bytes=raw;var name=original.replace(Regex("""[\\/\x00-\x1f]"""),"_").take(145)
 val pdf=raw.size>=5&&String(raw.copyOfRange(0,5),Charsets.US_ASCII)=="%PDF-";val jpg=raw.size>3&&(raw[0].toInt()and 255)==255&&(raw[1].toInt()and 255)==216;val png=raw.size>=8&&raw.copyOfRange(0,8).contentEquals(byteArrayOf(137.toByte(),80,78,71,13,10,26,10))
 if(pdf&&name.endsWith(".pdf",true)){mime="application/pdf"}else if((jpg&&(name.endsWith(".jpg",true)||name.endsWith(".jpeg",true)))||(png&&name.endsWith(".png",true))){
 val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(raw,0,raw.size,bounds);require(bounds.outWidth>0&&bounds.outHeight>0&&bounds.outWidth.toLong()*bounds.outHeight<=40000000)
 val options=BitmapFactory.Options().apply{inSampleSize=1};while(maxOf(bounds.outWidth,bounds.outHeight)/options.inSampleSize>4000)options.inSampleSize*=2
 val bitmap=BitmapFactory.decodeByteArray(raw,0,raw.size,options)?:throw IllegalStateException();val orientation=ExifInterface(raw.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);val matrix=Matrix();when(orientation){2->matrix.setScale(-1f,1f);3->matrix.setRotate(180f);4->{matrix.setRotate(180f);matrix.postScale(-1f,1f)};5->{matrix.setRotate(90f);matrix.postScale(-1f,1f)};6->matrix.setRotate(90f);7->{matrix.setRotate(-90f);matrix.postScale(-1f,1f)};8->matrix.setRotate(-90f)}
 val corrected=Bitmap.createBitmap(bitmap,0,0,bitmap.width,bitmap.height,matrix,true);val out=java.io.ByteArrayOutputStream();require(corrected.compress(Bitmap.CompressFormat.JPEG,92,out));bytes=out.toByteArray();if(corrected!==bitmap)corrected.recycle();bitmap.recycle();mime="image/jpeg";name=name.substringBeforeLast('.')+".jpg"
 }else throw UnsupportedOperationException()
 require(bytes.isNotEmpty()&&bytes.size<=args.getInt("maxBytes"));target.outputStream().use{it.write(bytes)};return JSONObject().put("id",target.name).put("uri",Uri.fromFile(target).toString()).put("originalFilename",name).put("mimeType",mime).put("sizeBytes",bytes.size).put("checksum",hash(bytes))
 }
 private fun download(args:JSONObject,promise:Promise){var target:File?=null;try{val url=java.net.URL(args.getString("url"));require(url.protocol=="https"&&url.userInfo==null);val connection=url.openConnection() as java.net.HttpURLConnection;connection.instanceFollowRedirects=false;connection.connectTimeout=15000;connection.readTimeout=60000;try{require(connection.responseCode==200);val bytes=connection.inputStream.use{bounded(it,args.getInt("maxBytes"))};require(bytes.size<=args.getInt("maxBytes")&&bytes.size==args.getInt("sizeBytes")&&hash(bytes)==args.getString("checksum"));target=file(args,UUID.randomUUID().toString());target!!.writeBytes(bytes);promise.resolve(JSONObject().put("id",target!!.name).put("uri",Uri.fromFile(target).toString()).toString())}finally{connection.disconnect()}}catch(_:Exception){target?.delete();fail(promise,"DOCUMENT_DOWNLOAD_FAILED")}}
 fun close(){pending?.reject("DOCUMENT_PICKER_CLOSED","Document picker closed; retry after reopening.");pending=null;context.removeActivityEventListener(this);worker.shutdown()}
}
